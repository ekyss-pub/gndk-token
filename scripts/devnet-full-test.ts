/**
 * GNDK Token — Devnet Full Integration Test
 *
 * TGE 완료된 Devnet 환경에서 localnet 40개 테스트에 해당하는
 * 전체 생태계 플로우를 검증합니다.
 *
 * tge-devnet-state.json에서 배포 상태를 읽어 사용합니다.
 *
 * 실행:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/dev/solana/dev-wallet.json \
 *   npx ts-node --transpile-only --project tsconfig.json scripts/devnet-full-test.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { GndkRegistry } from "../target/types/gndk_registry";
import { L2eModule } from "../target/types/l2e_module";
import { BurnRecycle } from "../target/types/burn_recycle";
import { VestingProgram } from "../target/types/vesting_program";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createTransferInstruction,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Connection,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// ════════════════════════════════════════
// Setup
// ════════════════════════════════════════

const STATE_FILE = path.join(__dirname, "tge-devnet-state.json");
const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));

const f = (obj: any, name: string) => {
  return obj[name] ?? obj[name.replace("l2e", "l2E").replace("d2e", "d2E")]
    ?? obj[name.replace("l2E", "l2e").replace("d2E", "d2e")];
};

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(name: string) {
  passed++;
  console.log(`  ✅ ${name}`);
}

function fail(name: string, err: any) {
  failed++;
  failures.push(`${name}: ${err.message || err}`);
  console.log(`  ❌ ${name}: ${err.message || err}`);
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("║  GNDK Devnet Full Integration Test                 ║");
  console.log("═══════════════════════════════════════════════════════\n");

  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
    "confirmed"
  );
  const walletPath = process.env.ANCHOR_WALLET
    || path.join(process.env.HOME!, "dev/solana/dev-wallet.json");
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const admin = wallet;
  const oracle = Keypair.fromSecretKey(
    Buffer.from(state.oracleKeypair, "base64")
  );

  const registry = anchor.workspace.gndkRegistry as Program<GndkRegistry>;
  const l2e = anchor.workspace.l2eModule as Program<L2eModule>;
  const burnRecycle = anchor.workspace.burnRecycle as Program<BurnRecycle>;
  const vesting = anchor.workspace.vestingProgram as Program<VestingProgram>;

  const mint = new PublicKey(state.mint);
  const configPda = new PublicKey(state.configPda);
  const poolAuthorityPda = new PublicKey(state.poolAuthorityPda);
  const d2ePoolAuthorityPda = new PublicKey(state.d2ePoolAuthorityPda);
  const poolAta = new PublicKey(state.poolAta);
  const d2ePoolAta = new PublicKey(state.d2ePoolAta);
  const l2eConfigPda = new PublicKey(state.l2eConfigPda);
  const l2eModulePda = new PublicKey(state.l2eModulePda);
  const burnConfigPda = new PublicKey(state.burnConfigPda);
  const vestingConfigPda = new PublicKey(state.vestingConfigPda);
  const vaultAuthorityPda = new PublicKey(state.vaultAuthorityPda);
  const vaultAta = new PublicKey(state.vaultAta);
  const adminAta = (await getOrCreateAssociatedTokenAccount(
    connection, admin.payer, mint, admin.publicKey
  )).address;

  const balance = await connection.getBalance(admin.publicKey);
  console.log("Network:", connection.rpcEndpoint);
  console.log("Mint:", mint.toBase58());
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL\n");

  // ══════════════════════════════════════
  // T1: Registry 상태 검증
  // ══════════════════════════════════════
  console.log("━━━ T1: Registry 상태 검증 ━━━");

  try {
    const config = await registry.account.configAccount.fetch(configPda);
    if (config.mint.toBase58() !== mint.toBase58()) throw new Error("Mint mismatch");
    if (config.currentPhase !== 0) throw new Error("Phase should be 0 (Phase 1)");
    if (config.admin.toBase58() !== admin.publicKey.toBase58()) throw new Error("Admin mismatch");
    ok("T1-1. ConfigAccount 정합성");
  } catch (e) { fail("T1-1. ConfigAccount 정합성", e); }

  try {
    const poolBal = Number((await getAccount(connection, poolAta)).amount) / 1e9;
    if (poolBal <= 0) throw new Error(`Pool balance is 0`);
    if (poolBal > 300_000_000) throw new Error(`Pool balance ${poolBal} > 300M (impossible)`);
    ok(`T1-2. L2E RewardPool 잔액: ${poolBal.toLocaleString()} GNDK`);
  } catch (e) { fail("T1-2. L2E RewardPool 잔액", e); }

  try {
    const d2eBal = Number((await getAccount(connection, d2ePoolAta)).amount) / 1e9;
    if (d2eBal !== 0) throw new Error(`D2E pool balance ${d2eBal} != 0`);
    ok("T1-3. D2E BountyPool 잔액 0 (empty)");
  } catch (e) { fail("T1-3. D2E BountyPool 잔액", e); }

  // ══════════════════════════════════════
  // T2: 유저 등록 + Dynamic Halving
  // ══════════════════════════════════════
  console.log("\n━━━ T2: 유저 등록 ━━━");

  const testUsers: Array<{ kp: Keypair; pda: PublicKey; ata: PublicKey }> = [];

  // Oracle에 SOL 전송 (PDA 생성 rent 비용 — devnet airdrop 대신 admin에서 직접 전송)
  try {
    const oracleBal = await connection.getBalance(oracle.publicKey);
    if (oracleBal < 0.1 * LAMPORTS_PER_SOL) {
      const tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: oracle.publicKey,
          lamports: 0.2 * LAMPORTS_PER_SOL,
        })
      );
      await provider.sendAndConfirm(tx);
      console.log("  (oracle에 0.2 SOL 전송)");
    }
  } catch (e) { console.log("  (oracle SOL 전송 실패, 이미 있을 수 있음)"); }

  try {
    for (let i = 0; i < 3; i++) {
      const kp = Keypair.generate();
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user"), kp.publicKey.toBuffer()], registry.programId
      );
      const ataAcc = await getOrCreateAssociatedTokenAccount(
        connection, admin.payer, mint, kp.publicKey
      );

      await registry.methods.registerUser()
        .accounts({
          config: configPda, userAccount: pda, user: kp.publicKey,
          authority: oracle.publicKey, systemProgram: SystemProgram.programId,
        })
        .signers([oracle])
        .rpc();

      testUsers.push({ kp, pda, ata: ataAcc.address });
    }

    const config = await registry.account.configAccount.fetch(configPda);
    if (config.totalRegisteredUsers.toNumber() < 3) throw new Error("User count < 3");
    ok("T2-1. 3명 유저 등록 (oracle 서명)");
  } catch (e) { fail("T2-1. 유저 등록", e); }

  // 비인가 등록 차단 (airdrop 대신 admin에서 SOL 전송)
  try {
    const rando = Keypair.generate();
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: admin.publicKey, toPubkey: rando.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx);

    const fakeUser = Keypair.generate();
    const [fakePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), fakeUser.publicKey.toBuffer()], registry.programId
    );

    try {
      await registry.methods.registerUser()
        .accounts({
          config: configPda, userAccount: fakePda, user: fakeUser.publicKey,
          authority: rando.publicKey, systemProgram: SystemProgram.programId,
        })
        .signers([rando])
        .rpc();
      throw new Error("Should have rejected");
    } catch (err: any) {
      if (err.message === "Should have rejected") throw err;
      ok("T2-2. 비인가 유저 등록 차단");
    }
  } catch (e) { fail("T2-2. 비인가 유저 등록 차단", e); }

  // ══════════════════════════════════════
  // T3: L2E 보상 (CPI)
  // ══════════════════════════════════════
  console.log("\n━━━ T3: L2E 보상 배분 (CPI) ━━━");

  try {
    await l2e.methods.distribute(new anchor.BN(50))
      .accounts({
        l2eConfig: l2eConfigPda, registryProgram: registry.programId,
        registryConfig: configPda, moduleAccount: l2eModulePda,
        poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
        userAccount: testUsers[0].pda, userAta: testUsers[0].ata,
        caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const bal = Number((await getAccount(connection, testUsers[0].ata)).amount) / 1e9;
    if (bal !== 50) throw new Error(`User0 balance ${bal} != 50`);
    ok("T3-1. L2E CPI: 50 GNDK → User0");
  } catch (e) { fail("T3-1. L2E CPI 배분", e); }

  // Phase cap 테스트 (70 GNDK)
  try {
    await l2e.methods.distribute(new anchor.BN(20))
      .accounts({
        l2eConfig: l2eConfigPda, registryProgram: registry.programId,
        registryConfig: configPda, moduleAccount: l2eModulePda,
        poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
        userAccount: testUsers[0].pda, userAta: testUsers[0].ata,
        caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const ua: any = await registry.account.userAccount.fetch(testUsers[0].pda);
    if (f(ua, "l2EAnnualClaimed").toNumber() !== 70) throw new Error("l2e claimed != 70");
    ok("T3-2. L2E +20 → 총 70 (Phase 1 cap 도달)");
  } catch (e) { fail("T3-2. Phase cap 도달", e); }

  // Cap 초과 차단
  try {
    try {
      await l2e.methods.distribute(new anchor.BN(1))
        .accounts({
          l2eConfig: l2eConfigPda, registryProgram: registry.programId,
          registryConfig: configPda, moduleAccount: l2eModulePda,
          poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
          userAccount: testUsers[0].pda, userAta: testUsers[0].ata,
          caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      throw new Error("Should have rejected");
    } catch (err: any) {
      if (err.message === "Should have rejected") throw err;
      ok("T3-3. Phase 1 cap 초과 차단 (71 > 70)");
    }
  } catch (e) { fail("T3-3. Phase cap 초과 차단", e); }

  // 다른 유저 배분
  try {
    await l2e.methods.distribute(new anchor.BN(30))
      .accounts({
        l2eConfig: l2eConfigPda, registryProgram: registry.programId,
        registryConfig: configPda, moduleAccount: l2eModulePda,
        poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
        userAccount: testUsers[1].pda, userAta: testUsers[1].ata,
        caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
    ok("T3-4. L2E 30 GNDK → User1");
  } catch (e) { fail("T3-4. L2E User1 배분", e); }

  // 비인가 caller 차단 (C-1 fix 검증)
  try {
    const rando = Keypair.generate();
    const fundTx3 = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: admin.publicKey, toPubkey: rando.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx3);

    try {
      await l2e.methods.distribute(new anchor.BN(1))
        .accounts({
          l2eConfig: l2eConfigPda, registryProgram: registry.programId,
          registryConfig: configPda, moduleAccount: l2eModulePda,
          poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
          userAccount: testUsers[1].pda, userAta: testUsers[1].ata,
          caller: rando.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([rando])
        .rpc();
      throw new Error("Should have rejected");
    } catch (err: any) {
      if (err.message === "Should have rejected") throw err;
      ok("T3-5. [C-1] 비인가 caller 차단 확인");
    }
  } catch (e) { fail("T3-5. [C-1] 비인가 caller 차단", e); }

  // ══════════════════════════════════════
  // T4: BurnRecycle
  // ══════════════════════════════════════
  console.log("\n━━━ T4: BurnRecycle ━━━");

  try {
    // User1에 SOL 전송 (트랜잭션 서명 비용)
    if (testUsers.length > 1) {
      const fundUser1 = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: admin.publicKey, toPubkey: testUsers[1].kp.publicKey,
          lamports: 0.05 * LAMPORTS_PER_SOL,
        })
      );
      await provider.sendAndConfirm(fundUser1);
    }

    const poolBefore = Number((await getAccount(connection, poolAta)).amount) / 1e9;

    // User1이 10 GNDK 결제 (User1은 30 GNDK 보유)
    await burnRecycle.methods.processPayment(new anchor.BN(10))
      .accounts({
        config: burnConfigPda, mint, payerAta: testUsers[1].ata,
        rewardPoolAta: poolAta, payer: testUsers[1].kp.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([testUsers[1].kp])
      .rpc();

    const poolAfter = Number((await getAccount(connection, poolAta)).amount) / 1e9;
    const recycled = poolAfter - poolBefore;
    if (Math.abs(recycled - 5) > 0.001) throw new Error(`Recycled ${recycled} != 5`);

    const userBal = Number((await getAccount(connection, testUsers[1].ata)).amount) / 1e9;
    if (Math.abs(userBal - 20) > 0.001) throw new Error(`User1 bal ${userBal} != 20`);

    ok("T4-1. process_payment: 10 GNDK → 5 burn + 5 recycle");
  } catch (e) { fail("T4-1. process_payment", e); }

  // Admin burn
  try {
    await burnRecycle.methods.adminBurn(new anchor.BN(100))
      .accounts({
        config: burnConfigPda, mint, adminAta,
        admin: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const configAfter = await burnRecycle.account.burnRecycleConfig.fetch(burnConfigPda);
    const adminBurnedAfter = configAfter.totalAdminBurned.toNumber() / 1e9;
    if (adminBurnedAfter < 100) throw new Error(`Admin burned ${adminBurnedAfter} < 100`);
    ok(`T4-2. admin_burn: 100 GNDK 소각 (누적 ${adminBurnedAfter})`);
  } catch (e) { fail("T4-2. admin_burn", e); }

  // BurnRecycle pause/unpause
  try {
    await burnRecycle.methods.pause()
      .accounts({ config: burnConfigPda, admin: admin.publicKey }).rpc();

    try {
      await burnRecycle.methods.processPayment(new anchor.BN(1))
        .accounts({
          config: burnConfigPda, mint, payerAta: testUsers[1].ata,
          rewardPoolAta: poolAta, payer: testUsers[1].kp.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([testUsers[1].kp])
        .rpc();
      throw new Error("Should have rejected");
    } catch (err: any) {
      if (err.message === "Should have rejected") throw err;
    }

    await burnRecycle.methods.unpause()
      .accounts({ config: burnConfigPda, admin: admin.publicKey }).rpc();
    ok("T4-3. BurnRecycle pause/unpause");
  } catch (e) { fail("T4-3. BurnRecycle pause/unpause", e); }

  // ══════════════════════════════════════
  // T5: Global Pause/Unpause
  // ══════════════════════════════════════
  console.log("\n━━━ T5: Global Pause ━━━");

  try {
    await registry.methods.pause()
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();

    try {
      await l2e.methods.distribute(new anchor.BN(1))
        .accounts({
          l2eConfig: l2eConfigPda, registryProgram: registry.programId,
          registryConfig: configPda, moduleAccount: l2eModulePda,
          poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
          userAccount: testUsers[2].pda, userAta: testUsers[2].ata,
          caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      throw new Error("Should have rejected");
    } catch (err: any) {
      if (err.message === "Should have rejected") throw err;
    }

    await registry.methods.unpause()
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();

    // 정상 복구 확인
    await l2e.methods.distribute(new anchor.BN(1))
      .accounts({
        l2eConfig: l2eConfigPda, registryProgram: registry.programId,
        registryConfig: configPda, moduleAccount: l2eModulePda,
        poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
        userAccount: testUsers[2].pda, userAta: testUsers[2].ata,
        caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    ok("T5-1. Global pause → 차단 → unpause → 정상 복구");
  } catch (e) { fail("T5-1. Global pause/unpause", e); }

  // Module pause
  try {
    await registry.methods.pauseModule()
      .accounts({ config: configPda, moduleAccount: l2eModulePda, admin: admin.publicKey }).rpc();

    try {
      await l2e.methods.distribute(new anchor.BN(1))
        .accounts({
          l2eConfig: l2eConfigPda, registryProgram: registry.programId,
          registryConfig: configPda, moduleAccount: l2eModulePda,
          poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
          userAccount: testUsers[2].pda, userAta: testUsers[2].ata,
          caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      throw new Error("Should have rejected");
    } catch (err: any) {
      if (err.message === "Should have rejected") throw err;
    }

    await registry.methods.unpauseModule()
      .accounts({ config: configPda, moduleAccount: l2eModulePda, admin: admin.publicKey }).rpc();

    ok("T5-2. Module pause → L2E 차단 → unpause");
  } catch (e) { fail("T5-2. Module pause/unpause", e); }

  // Oracle update
  try {
    const newOracle = Keypair.generate();
    await registry.methods.updateOracle(newOracle.publicKey)
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();

    const config = await registry.account.configAccount.fetch(configPda);
    if (config.oracle.toBase58() !== newOracle.publicKey.toBase58()) throw new Error("Oracle not updated");

    // Restore original oracle
    await registry.methods.updateOracle(oracle.publicKey)
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();

    ok("T5-3. Oracle 업데이트 + 복원");
  } catch (e) { fail("T5-3. Oracle update", e); }

  // ══════════════════════════════════════
  // T6: Vesting
  // ══════════════════════════════════════
  console.log("\n━━━ T6: Vesting (--fast: cliff=60s) ━━━");

  try {
    const vestingPda = new PublicKey(state.vestingAccounts.earlyContrib.pda);
    const va = await vesting.account.vestingAccount.fetch(vestingPda);
    if (va.totalAmount.toNumber() !== 100_000_000) throw new Error("Vesting amount != 100M");
    if (va.revoked !== false) throw new Error("Should not be revoked");
    ok("T6-1. earlyContrib 베스팅 스케줄 확인 (100M GNDK)");
  } catch (e) { fail("T6-1. Vesting 스케줄 확인", e); }

  try {
    const vestingPda = new PublicKey(state.vestingAccounts.teamAdvisor.pda);
    const va = await vesting.account.vestingAccount.fetch(vestingPda);
    if (va.totalAmount.toNumber() !== 50_000_000) throw new Error("Team vesting != 50M");
    ok("T6-2. teamAdvisor 베스팅 스케줄 확인 (50M GNDK)");
  } catch (e) { fail("T6-2. Team vesting 확인", e); }

  // Claim 시도 (cliff 이전이면 NothingToClaim, 이후면 성공)
  try {
    const beneficiaryKp = Keypair.generate(); // 새 수혜자로는 claim 불가 (PDA 없음)
    // earlyContrib의 beneficiary로 claim하려면 해당 keypair 필요 — 여기서는 스케줄 존재 확인만
    const vcConfig = await vesting.account.vestingConfig.fetch(vestingConfigPda);
    if (vcConfig.totalVestingCreated.toNumber() !== 250_000_000) throw new Error("Total created != 250M");
    ok("T6-3. Vesting 총 생성량 250M GNDK 확인");
  } catch (e) { fail("T6-3. Vesting 총 생성량", e); }

  // ══════════════════════════════════════
  // T7: 풀 잔액 정합성
  // ══════════════════════════════════════
  console.log("\n━━━ T7: 풀 잔액 정합성 ━━━");

  try {
    const config: any = await registry.account.configAccount.fetch(configPda);
    const burnConfig = await burnRecycle.account.burnRecycleConfig.fetch(burnConfigPda);
    const poolBal = Number((await getAccount(connection, poolAta)).amount) / 1e9;

    const l2eDistributed = config.totalDistributed.toNumber();
    const recycled = burnConfig.totalRecycled.toNumber() / 1e9;
    const expectedPool = 300_000_000 - l2eDistributed + recycled;

    if (Math.abs(poolBal - expectedPool) > 0.01) {
      throw new Error(`Pool ${poolBal} != expected ${expectedPool}`);
    }

    console.log(`    초기: 300,000,000 GNDK`);
    console.log(`    L2E 배분: -${l2eDistributed} GNDK`);
    console.log(`    리사이클: +${recycled} GNDK`);
    console.log(`    현재 풀: ${poolBal.toLocaleString()} GNDK`);
    ok("T7-1. 풀 잔액 = 초기 - L2E배분 + 리사이클");
  } catch (e) { fail("T7-1. 풀 잔액 정합성", e); }

  // ══════════════════════════════════════
  // T8: L2E Module 상태
  // ══════════════════════════════════════
  console.log("\n━━━ T8: L2E Module 상태 ━━━");

  try {
    const l2eConfig = await l2e.account.l2EConfig.fetch(l2eConfigPda);
    if (!l2eConfig.isActive) throw new Error("L2E should be active");
    console.log(`    L2E total distributed: ${l2eConfig.totalDistributed.toNumber()} GNDK`);
    ok("T8-1. L2E Module 활성 상태 확인");
  } catch (e) { fail("T8-1. L2E Module 상태", e); }

  // L2E pause/unpause
  try {
    await l2e.methods.pause()
      .accounts({ l2eConfig: l2eConfigPda, admin: admin.publicKey }).rpc();
    let config = await l2e.account.l2EConfig.fetch(l2eConfigPda);
    if (config.isActive !== false) throw new Error("Should be paused");

    await l2e.methods.unpause()
      .accounts({ l2eConfig: l2eConfigPda, admin: admin.publicKey }).rpc();
    config = await l2e.account.l2EConfig.fetch(l2eConfigPda);
    if (config.isActive !== true) throw new Error("Should be unpaused");

    ok("T8-2. L2E Module pause/unpause");
  } catch (e) { fail("T8-2. L2E pause/unpause", e); }

  // ══════════════════════════════════════
  // T9: BurnRecycle 통계
  // ══════════════════════════════════════
  console.log("\n━━━ T9: BurnRecycle 통계 ━━━");

  try {
    const config = await burnRecycle.account.burnRecycleConfig.fetch(burnConfigPda);
    const burned = config.totalBurned.toNumber() / 1e9;
    const recycled = config.totalRecycled.toNumber() / 1e9;
    const adminBurned = config.totalAdminBurned.toNumber() / 1e9;

    if (burned <= 0) throw new Error("Should have burned tokens");
    if (adminBurned < 100) throw new Error(`Admin burned ${adminBurned} < 100`);

    console.log(`    총 소각: ${burned} GNDK (결제 ${burned - adminBurned} + admin ${adminBurned})`);
    console.log(`    총 리사이클: ${recycled} GNDK`);
    ok("T9-1. BurnRecycle 통계 정합성");
  } catch (e) { fail("T9-1. BurnRecycle 통계", e); }

  // ══════════════════════════════════════
  // Summary
  // ══════════════════════════════════════
  const total = passed + failed;
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`║  Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ""}    `);
  console.log("═══════════════════════════════════════════════════════");

  if (failures.length > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  ❌ ${f}`));
  }

  // Final balances
  const finalSol = await connection.getBalance(admin.publicKey);
  console.log(`\nSOL used: ${((balance - finalSol) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`SOL remaining: ${(finalSol / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  console.log("═══════════════════════════════════════════════════════\n");

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("Test Error:", err);
  process.exit(1);
});
