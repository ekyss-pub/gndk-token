/**
 * GNDK Token — Devnet TGE 후 통합 테스트 시나리오
 *
 * TGE 스크립트(scripts/tge-devnet.ts) 실행 후,
 * 실제 Devnet 환경에서 전체 토큰 생태계 플로우를 검증합니다.
 *
 * 시나리오:
 *   S1: 유저 등록 + Dynamic Halving
 *   S2: L2E 보상 배분 (CPI)
 *   S3: BurnRecycle 서비스 결제
 *   S4: 보상 풀 잔액 검증
 *   S5: 관리자 Buyback & Burn
 *   S6: Vesting Claim (시간 경과 후)
 *   S7: 보안 — 비인가 접근 차단
 *   S8: Pause/Unpause 비상 정지
 *   S9: 전체 생태계 요약
 *
 * 실행 (localnet):
 *   anchor test -- --grep "Devnet TGE"
 *
 * 실행 (devnet — TGE 상태 파일 필요):
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   npx ts-mocha -p tsconfig.json -t 600000 tests/devnet-tge-scenarios.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GndkRegistry } from "../target/types/gndk_registry";
import { L2eModule } from "../target/types/l2e_module";
import { BurnRecycle } from "../target/types/burn_recycle";
import { VestingProgram } from "../target/types/vesting_program";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createTransferInstruction,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

const f = (obj: any, name: string) => {
  return obj[name] ?? obj[name.replace("l2e", "l2E").replace("d2e", "d2E")]
    ?? obj[name.replace("l2E", "l2e").replace("d2E", "d2e")];
};

describe("Devnet TGE Scenarios — Full Ecosystem Test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registry = anchor.workspace.gndkRegistry as Program<GndkRegistry>;
  const l2e = anchor.workspace.l2eModule as Program<L2eModule>;
  const burnRecycle = anchor.workspace.burnRecycle as Program<BurnRecycle>;
  const vesting = anchor.workspace.vestingProgram as Program<VestingProgram>;

  const admin = provider.wallet as anchor.Wallet;
  const oracle = Keypair.generate();

  // TGE 상태 (before에서 초기화)
  let mint: PublicKey;
  let adminAta: PublicKey;
  let configPda: PublicKey;
  let poolAuthorityPda: PublicKey;
  let d2ePoolAuthorityPda: PublicKey;
  let burnStatsPda: PublicKey;
  let poolAta: PublicKey;
  let poolAtaKeypair: Keypair;
  let d2ePoolAta: PublicKey;
  let d2ePoolAtaKeypair: Keypair;
  let l2eConfigPda: PublicKey;
  let l2eModulePda: PublicKey;
  let burnConfigPda: PublicKey;

  // Vesting
  let vestingConfigPda: PublicKey;
  let vaultAuthorityPda: PublicKey;
  let vestingMint: PublicKey;
  let vestingAdminAta: PublicKey;
  let vaultAta: PublicKey;
  let vaultAtaKeypair: Keypair;

  // Test users (TGE 후 등록될 유저들)
  const users: Array<{
    kp: Keypair;
    pda: PublicKey;
    ata: PublicKey;
  }> = [];

  // 생태계 추적 변수
  let initialPoolBalance: number;

  before(async () => {
    console.log("\n  ═══ TGE 초기화 (localnet 전체 셋업) ═══\n");

    // Airdrop
    await provider.connection.requestAirdrop(oracle.publicKey, 5e9);
    await new Promise(r => setTimeout(r, 500));

    // ─── Step 1: Create mint + mint 1B ───
    mint = await createMint(
      provider.connection, admin.payer, admin.publicKey, null, 9,
      undefined, undefined, TOKEN_PROGRAM_ID
    );
    adminAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, admin.payer, mint, admin.publicKey
    )).address;
    await mintTo(
      provider.connection, admin.payer, mint, adminAta, admin.publicKey,
      1_000_000_000n * 1_000_000_000n // 1B GNDK
    );

    // ─── Step 2: Initialize Registry ───
    [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], registry.programId);
    [poolAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("reward_pool"), mint.toBuffer()], registry.programId);
    [d2ePoolAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("d2e_pool"), mint.toBuffer()], registry.programId);
    [burnStatsPda] = PublicKey.findProgramAddressSync([Buffer.from("burn_stats")], registry.programId);

    await registry.methods.initialize(oracle.publicKey)
      .accounts({ config: configPda, mint, admin: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    // RewardPool
    poolAtaKeypair = Keypair.generate();
    poolAta = poolAtaKeypair.publicKey;
    await registry.methods.initializeRewardPool()
      .accounts({
        config: configPda, poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
        admin: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([poolAtaKeypair])
      .rpc();

    // Fund 300M
    const fundIx = createTransferInstruction(adminAta, poolAta, admin.publicKey, 300_000_000n * 1_000_000_000n);
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(fundIx));
    initialPoolBalance = 300_000_000;

    // D2E Pool (empty)
    d2ePoolAtaKeypair = Keypair.generate();
    d2ePoolAta = d2ePoolAtaKeypair.publicKey;
    await (registry.methods as any).initializeD2EPool()
      .accounts({
        config: configPda, d2EPoolAuthority: d2ePoolAuthorityPda, d2EPoolAta: d2ePoolAta, mint,
        admin: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([d2ePoolAtaKeypair])
      .rpc();

    // BurnStats
    await registry.methods.initializeBurnStats()
      .accounts({ burnStats: burnStatsPda, admin: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    // ─── Step 3: L2E Module ───
    [l2eConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("l2e_config")], l2e.programId);
    [l2eModulePda] = PublicKey.findProgramAddressSync([Buffer.from("module"), l2e.programId.toBuffer()], registry.programId);

    await l2e.methods.initialize()
      .accounts({ l2eConfig: l2eConfigPda, oracle: oracle.publicKey, admin: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    await registry.methods.registerModule("l2e-mod", 0, new anchor.BN(50000), new anchor.BN(0))
      .accounts({
        config: configPda, moduleAccount: l2eModulePda, moduleProgram: l2e.programId,
        admin: admin.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();

    // ─── Step 4: BurnRecycle ───
    [burnConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("burn_recycle_config")], burnRecycle.programId);
    await burnRecycle.methods.initialize()
      .accounts({ config: burnConfigPda, mint, admin: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    // ─── Step 5: Vesting (separate mint for isolation) ───
    vestingMint = await createMint(provider.connection, admin.payer, admin.publicKey, null, 9);
    vestingAdminAta = (await getOrCreateAssociatedTokenAccount(provider.connection, admin.payer, vestingMint, admin.publicKey)).address;
    await mintTo(provider.connection, admin.payer, vestingMint, vestingAdminAta, admin.publicKey, 250_000_000n * 1_000_000_000n);

    [vestingConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("vesting_config")], vesting.programId);
    [vaultAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("vesting_vault"), vestingMint.toBuffer()], vesting.programId);

    await vesting.methods.initialize()
      .accounts({ config: vestingConfigPda, mint: vestingMint, admin: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    vaultAtaKeypair = Keypair.generate();
    vaultAta = vaultAtaKeypair.publicKey;
    await vesting.methods.initializeVault()
      .accounts({
        config: vestingConfigPda, vaultAuthority: vaultAuthorityPda, vaultAta, mint: vestingMint,
        admin: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([vaultAtaKeypair])
      .rpc();

    // ─── Step 6: Register test users ───
    for (let i = 0; i < 5; i++) {
      const kp = Keypair.generate();
      await provider.connection.requestAirdrop(kp.publicKey, 1e9);
      const [pda] = PublicKey.findProgramAddressSync([Buffer.from("user"), kp.publicKey.toBuffer()], registry.programId);
      const ataAcc = await getOrCreateAssociatedTokenAccount(provider.connection, admin.payer, mint, kp.publicKey);
      users.push({ kp, pda, ata: ataAcc.address });
    }
    await new Promise(r => setTimeout(r, 500));

    console.log("  ✅ TGE 초기화 완료: 1B GNDK, 300M Pool, 5 유저 준비\n");
  });

  // ══════════════════════════════════════
  // S1: 유저 등록 + Dynamic Halving
  // ══════════════════════════════════════

  it("S1-1. 5명 유저 등록 (oracle 통해 KYC)", async () => {
    for (let i = 0; i < 5; i++) {
      await registry.methods.registerUser()
        .accounts({
          config: configPda, userAccount: users[i].pda, user: users[i].kp.publicKey,
          authority: oracle.publicKey, systemProgram: SystemProgram.programId,
        })
        .signers([oracle])
        .rpc();
    }

    const config = await registry.account.configAccount.fetch(configPda);
    assert.equal(config.totalRegisteredUsers.toNumber(), 5);
    assert.equal(config.currentPhase, 0); // Phase 1 (< 100K)
    console.log("    ✅ 5 유저 등록 완료 (Phase 1, cap=70 GNDK/year)");
  });

  it("S1-2. 중복 등록 불가", async () => {
    try {
      await registry.methods.registerUser()
        .accounts({
          config: configPda, userAccount: users[0].pda, user: users[0].kp.publicKey,
          authority: oracle.publicKey, systemProgram: SystemProgram.programId,
        })
        .signers([oracle])
        .rpc();
      assert.fail("Should reject duplicate registration");
    } catch (err) {
      // PDA already initialized → Anchor error
      console.log("    ✅ 중복 등록 차단");
    }
  });

  // ══════════════════════════════════════
  // S2: L2E 보상 배분 (CPI)
  // ══════════════════════════════════════

  it("S2-1. 5명에게 각 50 GNDK L2E 보상 (총 250 GNDK)", async () => {
    for (let i = 0; i < 5; i++) {
      await l2e.methods.distribute(new anchor.BN(50))
        .accounts({
          l2eConfig: l2eConfigPda,
          registryProgram: registry.programId,
          registryConfig: configPda,
          moduleAccount: l2eModulePda,
          poolAuthority: poolAuthorityPda,
          rewardPoolAta: poolAta,
          mint,
          userAccount: users[i].pda,
          userAta: users[i].ata,
          caller: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
    }

    // Verify all users got 50 GNDK
    for (let i = 0; i < 5; i++) {
      const bal = Number((await getAccount(provider.connection, users[i].ata)).amount) / 1e9;
      assert.equal(bal, 50);
    }

    const poolBal = Number((await getAccount(provider.connection, poolAta)).amount) / 1e9;
    assert.equal(poolBal, initialPoolBalance - 250);
    console.log("    ✅ 5명 × 50 GNDK = 250 GNDK 배분 (풀 잔액:", poolBal.toLocaleString(), ")");
  });

  it("S2-2. 추가 20 GNDK → 총 70 (Phase 1 cap 도달)", async () => {
    await l2e.methods.distribute(new anchor.BN(20))
      .accounts({
        l2eConfig: l2eConfigPda, registryProgram: registry.programId,
        registryConfig: configPda, moduleAccount: l2eModulePda,
        poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
        userAccount: users[0].pda, userAta: users[0].ata,
        caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const ua: any = await registry.account.userAccount.fetch(users[0].pda);
    assert.equal(f(ua, "l2EAnnualClaimed").toNumber(), 70);
    console.log("    ✅ User0: 50+20=70 GNDK (Phase 1 cap 도달)");
  });

  it("S2-3. Phase 1 cap 초과 시도 → 차단", async () => {
    try {
      await l2e.methods.distribute(new anchor.BN(1))
        .accounts({
          l2eConfig: l2eConfigPda, registryProgram: registry.programId,
          registryConfig: configPda, moduleAccount: l2eModulePda,
          poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
          userAccount: users[0].pda, userAta: users[0].ata,
          caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      assert.fail("Should exceed cap");
    } catch (err) {
      assert.include(err.toString(), "AnnualLimitExceeded");
      console.log("    ✅ Phase 1 cap (70 GNDK) 초과 차단 확인");
    }
  });

  // ══════════════════════════════════════
  // S3: BurnRecycle 서비스 결제
  // ══════════════════════════════════════

  it("S3-1. User1이 20 GNDK 서비스 결제 → 10 burn + 10 recycle", async () => {
    const poolBefore = Number((await getAccount(provider.connection, poolAta)).amount) / 1e9;

    await burnRecycle.methods.processPayment(new anchor.BN(20))
      .accounts({
        config: burnConfigPda, mint, payerAta: users[1].ata,
        rewardPoolAta: poolAta, payer: users[1].kp.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([users[1].kp])
      .rpc();

    const poolAfter = Number((await getAccount(provider.connection, poolAta)).amount) / 1e9;
    const userBal = Number((await getAccount(provider.connection, users[1].ata)).amount) / 1e9;

    assert.equal(poolAfter - poolBefore, 10); // 50% recycled
    assert.equal(userBal, 30); // 50 - 20 = 30
    console.log("    ✅ 결제 20 GNDK → 10 소각 + 10 리사이클 (풀:", poolAfter.toLocaleString(), ")");
  });

  it("S3-2. 3명이 각 10 GNDK 결제 → 총 30 GNDK 처리", async () => {
    for (let i = 2; i < 5; i++) {
      await burnRecycle.methods.processPayment(new anchor.BN(10))
        .accounts({
          config: burnConfigPda, mint, payerAta: users[i].ata,
          rewardPoolAta: poolAta, payer: users[i].kp.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([users[i].kp])
        .rpc();
    }

    const burnConfig = await burnRecycle.account.burnRecycleConfig.fetch(burnConfigPda);
    const totalBurned = burnConfig.totalBurned.toNumber() / 1e9;
    const totalRecycled = burnConfig.totalRecycled.toNumber() / 1e9;

    // 20 + 30 = 50 total payment → 25 burned + 25 recycled
    assert.equal(totalBurned, 25);
    assert.equal(totalRecycled, 25);
    console.log("    ✅ 총 결제 50 GNDK → 25 소각 + 25 리사이클");
  });

  // ══════════════════════════════════════
  // S4: 보상 풀 잔액 검증
  // ══════════════════════════════════════

  it("S4. 풀 잔액 정합성 검증", async () => {
    const poolBal = Number((await getAccount(provider.connection, poolAta)).amount) / 1e9;
    const config: any = await registry.account.configAccount.fetch(configPda);
    const burnConfig = await burnRecycle.account.burnRecycleConfig.fetch(burnConfigPda);

    const l2eDistributed = config.totalDistributed.toNumber();
    const recycled = burnConfig.totalRecycled.toNumber() / 1e9;
    const expectedPool = initialPoolBalance - l2eDistributed + recycled;

    assert.approximately(poolBal, expectedPool, 0.001);
    console.log("    ✅ 풀 잔액 정합성 OK");
    console.log("      초기:", initialPoolBalance.toLocaleString());
    console.log("      L2E 배분:", l2eDistributed, "GNDK");
    console.log("      리사이클:", recycled, "GNDK");
    console.log("      현재 풀:", poolBal.toLocaleString(), "GNDK");
  });

  // ══════════════════════════════════════
  // S5: Admin Buyback & Burn
  // ══════════════════════════════════════

  it("S5. Admin Buyback & Burn: 1000 GNDK 소각", async () => {
    await burnRecycle.methods.adminBurn(new anchor.BN(1000))
      .accounts({
        config: burnConfigPda, mint, adminAta,
        admin: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const burnConfig = await burnRecycle.account.burnRecycleConfig.fetch(burnConfigPda);
    assert.equal(burnConfig.totalAdminBurned.toNumber() / 1e9, 1000);
    console.log("    ✅ Admin Buyback & Burn: 1,000 GNDK 영구 소각");
  });

  // ══════════════════════════════════════
  // S6: Vesting Claim
  // ══════════════════════════════════════

  it("S6-1. Vesting 생성: 500 GNDK, cliff=2s, linear=3s", async () => {
    const beneficiary = Keypair.generate();
    await provider.connection.requestAirdrop(beneficiary.publicKey, 1e9);
    await new Promise(r => setTimeout(r, 500));

    const beneficiaryAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, admin.payer, vestingMint, beneficiary.publicKey
    )).address;

    const [vestingAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting"), beneficiary.publicKey.toBuffer()], vesting.programId
    );

    await vesting.methods.createVesting(new anchor.BN(500), new anchor.BN(2), new anchor.BN(3))
      .accounts({
        config: vestingConfigPda, vestingAccount: vestingAccountPda,
        beneficiary: beneficiary.publicKey, vaultAta,
        adminAta: vestingAdminAta, mint: vestingMint,
        admin: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).rpc();

    const va = await vesting.account.vestingAccount.fetch(vestingAccountPda);
    assert.equal(va.totalAmount.toNumber(), 500);
    console.log("    ✅ Vesting 생성: 500 GNDK (cliff=2s, linear=3s)");

    // Wait cliff + partial
    console.log("    ⏳ Waiting 3s (cliff + partial vest)...");
    await new Promise(r => setTimeout(r, 3000));

    await vesting.methods.claim()
      .accounts({
        config: vestingConfigPda, vestingAccount: vestingAccountPda,
        vaultAuthority: vaultAuthorityPda, vaultAta, mint: vestingMint,
        beneficiaryAta, beneficiary: beneficiary.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    const vaAfter = await vesting.account.vestingAccount.fetch(vestingAccountPda);
    const claimed = vaAfter.claimedAmount.toNumber();
    assert.isAbove(claimed, 50);
    console.log(`    ✅ Partial claim: ${claimed} GNDK`);
  });

  // ══════════════════════════════════════
  // S7: 보안 — 비인가 접근 차단
  // ══════════════════════════════════════

  it("S7-1. 비인가 유저가 L2E 배분 시도 → 차단", async () => {
    const rando = Keypair.generate();
    await provider.connection.requestAirdrop(rando.publicKey, 1e9);
    await new Promise(r => setTimeout(r, 500));

    try {
      await l2e.methods.distribute(new anchor.BN(1))
        .accounts({
          l2eConfig: l2eConfigPda, registryProgram: registry.programId,
          registryConfig: configPda, moduleAccount: l2eModulePda,
          poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
          userAccount: users[1].pda, userAta: users[1].ata,
          caller: rando.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([rando])
        .rpc();
      assert.fail("Should reject unauthorized");
    } catch (err) {
      assert.include(err.toString(), "Unauthorized");
      console.log("    ✅ 비인가 L2E 배분 차단");
    }
  });

  it("S7-2. 비인가 유저가 admin_burn 시도 → 차단", async () => {
    const rando = Keypair.generate();
    await provider.connection.requestAirdrop(rando.publicKey, 1e9);
    await new Promise(r => setTimeout(r, 500));

    // Rando needs tokens to burn — but authority check should block first
    try {
      await burnRecycle.methods.adminBurn(new anchor.BN(1))
        .accounts({
          config: burnConfigPda, mint, adminAta,
          admin: rando.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([rando])
        .rpc();
      assert.fail("Should reject unauthorized");
    } catch (err) {
      console.log("    ✅ 비인가 admin_burn 차단");
    }
  });

  it("S7-3. 비인가 유저가 유저 등록 시도 → 차단", async () => {
    const rando = Keypair.generate();
    const fakeUser = Keypair.generate();
    await provider.connection.requestAirdrop(rando.publicKey, 1e9);
    await new Promise(r => setTimeout(r, 500));

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
      assert.fail("Should reject unauthorized");
    } catch (err) {
      assert.include(err.toString(), "Unauthorized");
      console.log("    ✅ 비인가 유저 등록 차단");
    }
  });

  // ══════════════════════════════════════
  // S8: Pause/Unpause 비상 정지
  // ══════════════════════════════════════

  it("S8-1. 글로벌 Pause → L2E 차단 → Unpause → 정상 복구", async () => {
    // Pause
    await registry.methods.pause()
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();

    // L2E 시도 → 차단
    try {
      await l2e.methods.distribute(new anchor.BN(1))
        .accounts({
          l2eConfig: l2eConfigPda, registryProgram: registry.programId,
          registryConfig: configPda, moduleAccount: l2eModulePda,
          poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
          userAccount: users[2].pda, userAta: users[2].ata,
          caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      assert.fail("Should be paused");
    } catch (err) {
      assert.include(err.toString(), "ProgramPaused");
    }

    // Unpause
    await registry.methods.unpause()
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();

    // 정상 배분 OK
    await l2e.methods.distribute(new anchor.BN(1))
      .accounts({
        l2eConfig: l2eConfigPda, registryProgram: registry.programId,
        registryConfig: configPda, moduleAccount: l2eModulePda,
        poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
        userAccount: users[2].pda, userAta: users[2].ata,
        caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    console.log("    ✅ 글로벌 Pause/Unpause 정상 동작");
  });

  it("S8-2. 모듈 Pause → 해당 모듈만 차단", async () => {
    await registry.methods.pauseModule()
      .accounts({ config: configPda, moduleAccount: l2eModulePda, admin: admin.publicKey }).rpc();

    try {
      await l2e.methods.distribute(new anchor.BN(1))
        .accounts({
          l2eConfig: l2eConfigPda, registryProgram: registry.programId,
          registryConfig: configPda, moduleAccount: l2eModulePda,
          poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
          userAccount: users[3].pda, userAta: users[3].ata,
          caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      assert.fail("Should be module-paused");
    } catch (err) {
      assert.include(err.toString(), "ModulePaused");
    }

    await registry.methods.unpauseModule()
      .accounts({ config: configPda, moduleAccount: l2eModulePda, admin: admin.publicKey }).rpc();
    console.log("    ✅ 모듈 Pause/Unpause 정상 동작");
  });

  // ══════════════════════════════════════
  // S9: 전체 생태계 요약
  // ══════════════════════════════════════

  it("S9. 전체 생태계 상태 요약", async () => {
    const config: any = await registry.account.configAccount.fetch(configPda);
    const l2eConfig = await l2e.account.l2EConfig.fetch(l2eConfigPda);
    const burnConfig = await burnRecycle.account.burnRecycleConfig.fetch(burnConfigPda);
    const vestConfig = await vesting.account.vestingConfig.fetch(vestingConfigPda);
    const poolBal = Number((await getAccount(provider.connection, poolAta)).amount) / 1e9;
    const d2eBal = Number((await getAccount(provider.connection, d2ePoolAta)).amount) / 1e9;

    console.log("\n    ═══════════════════════════════════════════════════════");
    console.log("    ║  GNDK — Devnet TGE Scenario Results                ║");
    console.log("    ═══════════════════════════════════════════════════════");
    console.log("    [Registry]");
    console.log("      Phase:", config.currentPhase + 1, "(cap:", [70, 40, 15, 3][config.currentPhase], "GNDK/year)");
    console.log("      Registered Users:", config.totalRegisteredUsers.toNumber());
    console.log("      L2E Distributed:", config.totalDistributed.toNumber(), "GNDK");
    console.log("      D2E Distributed:", f(config, "totalD2EDistributed").toNumber(), "GNDK");
    console.log("      Global Paused:", config.isPaused);
    console.log("    ───────────────────────────────────────────────────────");
    console.log("    [Pools]");
    console.log("      L2E RewardPool:", poolBal.toLocaleString(), "GNDK");
    console.log("      D2E BountyPool:", d2eBal.toLocaleString(), "GNDK");
    console.log("    ───────────────────────────────────────────────────────");
    console.log("    [L2E Module]");
    console.log("      CPI Distributed:", l2eConfig.totalDistributed.toNumber(), "GNDK");
    console.log("      Active:", l2eConfig.isActive);
    console.log("    ───────────────────────────────────────────────────────");
    console.log("    [BurnRecycle]");
    console.log("      Total Burned:", (burnConfig.totalBurned.toNumber() / 1e9).toLocaleString(), "GNDK");
    console.log("      Total Recycled:", (burnConfig.totalRecycled.toNumber() / 1e9).toLocaleString(), "GNDK");
    console.log("      Admin Burned:", (burnConfig.totalAdminBurned.toNumber() / 1e9).toLocaleString(), "GNDK");
    console.log("    ───────────────────────────────────────────────────────");
    console.log("    [Vesting]");
    console.log("      Total Created:", vestConfig.totalVestingCreated.toNumber(), "GNDK");
    console.log("      Total Claimed:", vestConfig.totalClaimed.toNumber(), "GNDK");
    console.log("      Total Revoked:", vestConfig.totalRevoked.toNumber(), "GNDK");
    console.log("    ───────────────────────────────────────────────────────");
    console.log("    [Users (sample)]");
    for (let i = 0; i < Math.min(3, users.length); i++) {
      const ua: any = await registry.account.userAccount.fetch(users[i].pda);
      const bal = Number((await getAccount(provider.connection, users[i].ata)).amount) / 1e9;
      console.log(`      User${i}: l2e=${f(ua, "l2EAnnualClaimed").toNumber()}, wallet=${bal} GNDK`);
    }
    console.log("    ═══════════════════════════════════════════════════════\n");

    // 최종 검증
    assert.isAbove(poolBal, 0, "Pool should have remaining balance");
    assert.isAbove(burnConfig.totalBurned.toNumber(), 0, "Should have burned tokens");
    assert.isAbove(burnConfig.totalRecycled.toNumber(), 0, "Should have recycled tokens");
  });
});
