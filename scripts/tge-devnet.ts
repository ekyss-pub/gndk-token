/**
 * GNDK Token — TGE Devnet Deployment Script
 *
 * 사양서 Section 8.8 기준 TGE 초기화 시퀀스
 * Devnet에서 실행하여 전체 TGE 프로세스를 리허설합니다.
 *
 * 사전 조건:
 *   1. `anchor build` 완료
 *   2. `solana config set --url devnet`
 *   3. Dev wallet에 충분한 SOL (최소 5 SOL)
 *   4. `anchor deploy --provider.cluster devnet`로 4개 프로그램 배포 완료
 *
 * 실행:
 *   npx ts-node --project tsconfig.json scripts/tge-devnet.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
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
  setAuthority,
  AuthorityType,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Connection,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// ════════════════════════════════════════
// Configuration
// ════════════════════════════════════════

const TOTAL_SUPPLY = 1_000_000_000; // 1B GNDK
const DECIMALS = 9;
const DECIMALS_FACTOR = BigInt(10 ** DECIMALS);

// Token Distribution (Section 3.2)
const DISTRIBUTION = {
  ecosystemReward: { pct: 30, amount: 300_000_000 },  // L2E 보상 풀
  foundation:      { pct: 25, amount: 250_000_000 },  // 재단 (즉시 해제)
  earlyContrib:    { pct: 10, amount: 100_000_000 },  // 초기 기여자 (1Y cliff + 1Y linear)
  privateSale:     { pct: 10, amount: 100_000_000 },  // 프라이빗 세일 (1Y cliff + 1Y linear)
  marketing:       { pct: 10, amount: 100_000_000 },  // 마케팅 (즉시 해제)
  partnership:     { pct:  5, amount:  50_000_000 },   // 파트너십 (즉시 해제)
  teamAdvisor:     { pct:  5, amount:  50_000_000 },   // 팀/어드바이저 (1Y cliff + 2Y linear)
  donation:        { pct:  5, amount:  50_000_000 },   // 기부/사회공헌 (즉시 해제)
};

// Vesting durations (seconds)
const YEAR_SECONDS = 365.25 * 24 * 3600;
// Devnet: 빠른 테스트를 위해 축소된 기간 사용 (옵션)
const USE_SHORT_VESTING = process.argv.includes("--fast");
const CLIFF_1Y = USE_SHORT_VESTING ? 60 : Math.floor(YEAR_SECONDS);      // 1년 또는 60초
const LINEAR_1Y = USE_SHORT_VESTING ? 60 : Math.floor(YEAR_SECONDS);     // 1년 또는 60초
const LINEAR_2Y = USE_SHORT_VESTING ? 120 : Math.floor(YEAR_SECONDS * 2); // 2년 또는 120초

// ════════════════════════════════════════
// State file (devnet 배포 상태 저장)
// ════════════════════════════════════════

interface TGEState {
  network: string;
  timestamp: string;
  mint: string;
  adminWallet: string;
  oracleKeypair: string;
  configPda: string;
  poolAuthorityPda: string;
  d2ePoolAuthorityPda: string;
  burnStatsPda: string;
  poolAta: string;
  d2ePoolAta: string;
  l2eConfigPda: string;
  l2eModulePda: string;
  burnConfigPda: string;
  vestingConfigPda: string;
  vaultAuthorityPda: string;
  vaultAta: string;
  distribution: Record<string, { wallet: string; ata: string; amount: number }>;
  vestingAccounts: Record<string, { pda: string; beneficiary: string; amount: number }>;
  mintAuthorityRenounced: boolean;
  freezeAuthorityRenounced: boolean;
}

const STATE_FILE = path.join(__dirname, "tge-devnet-state.json");

function saveState(state: TGEState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`  💾 State saved to ${STATE_FILE}`);
}

// ════════════════════════════════════════
// Main TGE Script
// ════════════════════════════════════════

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("║  GNDK Token — TGE Devnet Deployment                ║");
  console.log("║  Spec: EKYSS_L2E_TOKENOMICS_SOLANA.md v2.5.4-sol   ║");
  console.log("═══════════════════════════════════════════════════════\n");

  // ─── Setup ───
  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"),
    "confirmed"
  );
  const walletPath = process.env.ANCHOR_WALLET
    || path.join(process.env.HOME!, ".config/solana/id.json");
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const admin = wallet;
  const adminPubkey = admin.publicKey;

  // Load programs
  const registry = anchor.workspace.gndkRegistry as Program<GndkRegistry>;
  const l2e = anchor.workspace.l2eModule as Program<L2eModule>;
  const burnRecycle = anchor.workspace.burnRecycle as Program<BurnRecycle>;
  const vesting = anchor.workspace.vestingProgram as Program<VestingProgram>;

  console.log("Network:", connection.rpcEndpoint);
  console.log("Admin:", adminPubkey.toBase58());
  console.log("Programs:");
  console.log("  Registry:", registry.programId.toBase58());
  console.log("  L2E:     ", l2e.programId.toBase58());
  console.log("  Burn:    ", burnRecycle.programId.toBase58());
  console.log("  Vesting: ", vesting.programId.toBase58());

  const balance = await connection.getBalance(adminPubkey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL\n");

  if (balance < 3 * LAMPORTS_PER_SOL) {
    console.log("⚠️  SOL 부족! 최소 3 SOL 필요. `solana airdrop 5` 실행하세요.");
    return;
  }

  // Oracle keypair (devnet용 — 프로덕션에서는 별도 관리)
  const oracle = Keypair.generate();

  // ─── Initialize state tracking ───
  const state: TGEState = {
    network: connection.rpcEndpoint,
    timestamp: new Date().toISOString(),
    mint: "", adminWallet: adminPubkey.toBase58(),
    oracleKeypair: Buffer.from(oracle.secretKey).toString("base64"),
    configPda: "", poolAuthorityPda: "", d2ePoolAuthorityPda: "",
    burnStatsPda: "", poolAta: "", d2ePoolAta: "",
    l2eConfigPda: "", l2eModulePda: "",
    burnConfigPda: "",
    vestingConfigPda: "", vaultAuthorityPda: "", vaultAta: "",
    distribution: {},
    vestingAccounts: {},
    mintAuthorityRenounced: false,
    freezeAuthorityRenounced: false,
  };

  // ══════════════════════════════════════
  // Step 1: Create SPL Token (GNDK)
  // ══════════════════════════════════════
  console.log("━━━ Step 1: Create GNDK SPL Token ━━━");

  const mint = await createMint(
    connection, admin.payer, adminPubkey, adminPubkey, // mintAuth + freezeAuth = admin
    DECIMALS, undefined, undefined, TOKEN_PROGRAM_ID
  );
  state.mint = mint.toBase58();
  console.log("  Mint:", mint.toBase58());

  // Mint 1B GNDK to admin
  const adminAta = (await getOrCreateAssociatedTokenAccount(
    connection, admin.payer, mint, adminPubkey
  )).address;

  await mintTo(
    connection, admin.payer, mint, adminAta, adminPubkey,
    BigInt(TOTAL_SUPPLY) * DECIMALS_FACTOR
  );
  console.log("  ✅ Minted:", TOTAL_SUPPLY.toLocaleString(), "GNDK to admin");

  // ══════════════════════════════════════
  // Step 2: Initialize Registry (Core)
  // ══════════════════════════════════════
  console.log("\n━━━ Step 2: Initialize Registry ━━━");

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")], registry.programId);
  const [poolAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reward_pool"), mint.toBuffer()], registry.programId);
  const [d2ePoolAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("d2e_pool"), mint.toBuffer()], registry.programId);
  const [burnStatsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("burn_stats")], registry.programId);

  state.configPda = configPda.toBase58();
  state.poolAuthorityPda = poolAuthorityPda.toBase58();
  state.d2ePoolAuthorityPda = d2ePoolAuthorityPda.toBase58();
  state.burnStatsPda = burnStatsPda.toBase58();

  // 2a. Initialize config
  await registry.methods.initialize(oracle.publicKey)
    .accounts({ config: configPda, mint, admin: adminPubkey, systemProgram: SystemProgram.programId })
    .rpc();
  console.log("  ✅ ConfigAccount initialized (oracle:", oracle.publicKey.toBase58().slice(0, 8) + "...)");

  // 2b. Initialize L2E RewardPool
  const poolAtaKeypair = Keypair.generate();
  const poolAta = poolAtaKeypair.publicKey;
  state.poolAta = poolAta.toBase58();

  await registry.methods.initializeRewardPool()
    .accounts({
      config: configPda, poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
      admin: adminPubkey, tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([poolAtaKeypair])
    .rpc();
  console.log("  ✅ L2E RewardPool ATA created");

  // 2c. Initialize D2E BountyPool (empty)
  const d2ePoolAtaKeypair = Keypair.generate();
  const d2ePoolAta = d2ePoolAtaKeypair.publicKey;
  state.d2ePoolAta = d2ePoolAta.toBase58();

  await (registry.methods as any).initializeD2EPool()
    .accounts({
      config: configPda, d2EPoolAuthority: d2ePoolAuthorityPda, d2EPoolAta: d2ePoolAta, mint,
      admin: adminPubkey, tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([d2ePoolAtaKeypair])
    .rpc();
  console.log("  ✅ D2E BountyPool ATA created (empty)");

  // 2d. Initialize BurnStats
  await registry.methods.initializeBurnStats()
    .accounts({ burnStats: burnStatsPda, admin: adminPubkey, systemProgram: SystemProgram.programId })
    .rpc();
  console.log("  ✅ BurnStats initialized");

  // ══════════════════════════════════════
  // Step 3: Token Distribution
  // ══════════════════════════════════════
  console.log("\n━━━ Step 3: Token Distribution (10억 GNDK) ━━━");

  // 3a. Fund L2E RewardPool (30% = 300M)
  const fundPoolIx = createTransferInstruction(
    adminAta, poolAta, adminPubkey,
    BigInt(DISTRIBUTION.ecosystemReward.amount) * DECIMALS_FACTOR
  );
  await provider.sendAndConfirm(new anchor.web3.Transaction().add(fundPoolIx));
  console.log("  ✅ L2E RewardPool:", DISTRIBUTION.ecosystemReward.amount.toLocaleString(), "GNDK (30%)");

  // 3b. Foundation, Marketing, Partnership, Donation → 즉시 해제 (devnet: 그냥 admin에 보유)
  for (const [name, info] of Object.entries(DISTRIBUTION)) {
    if (["ecosystemReward", "earlyContrib", "privateSale", "teamAdvisor"].includes(name)) continue;
    state.distribution[name] = {
      wallet: adminPubkey.toBase58(),
      ata: adminAta.toBase58(),
      amount: info.amount,
    };
    console.log(`  ✅ ${name}: ${info.amount.toLocaleString()} GNDK (${info.pct}%) — admin에 보유`);
  }

  // ══════════════════════════════════════
  // Step 4: Initialize L2E Module
  // ══════════════════════════════════════
  console.log("\n━━━ Step 4: Initialize L2E Module ━━━");

  const [l2eConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("l2e_config")], l2e.programId);
  const [l2eModulePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("module"), l2e.programId.toBuffer()], registry.programId);

  state.l2eConfigPda = l2eConfigPda.toBase58();
  state.l2eModulePda = l2eModulePda.toBase58();

  await l2e.methods.initialize()
    .accounts({
      l2eConfig: l2eConfigPda, oracle: oracle.publicKey,
      mint: mint,
      admin: adminPubkey, systemProgram: SystemProgram.programId,
    }).rpc();
  console.log("  ✅ L2E Module initialized — mint bound");

  // Register L2E Module in Registry (daily=10000 GNDK, annual=0 → Phase cap applies)
  await registry.methods.registerModule("l2e-module", 0, new anchor.BN(10000), new anchor.BN(0))
    .accounts({
      config: configPda, moduleAccount: l2eModulePda,
      moduleProgram: l2e.programId,
      admin: adminPubkey, systemProgram: SystemProgram.programId,
    }).rpc();
  console.log("  ✅ L2E Module registered in Registry (daily=10000, Phase cap)");

  // ══════════════════════════════════════
  // Step 5: Initialize BurnRecycle
  // ══════════════════════════════════════
  console.log("\n━━━ Step 5: Initialize BurnRecycle ━━━");

  const [burnConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("burn_recycle_config")], burnRecycle.programId);
  state.burnConfigPda = burnConfigPda.toBase58();

  await burnRecycle.methods.initialize()
    .accounts({
      config: burnConfigPda, mint, admin: adminPubkey,
      systemProgram: SystemProgram.programId,
    }).rpc();
  console.log("  ✅ BurnRecycle initialized (50% burn + 50% recycle)");

  // ══════════════════════════════════════
  // Step 6: Initialize Vesting + Create Schedules
  // ══════════════════════════════════════
  console.log("\n━━━ Step 6: Vesting Program ━━━");

  const [vestingConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vesting_config")], vesting.programId);
  const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vesting_vault"), mint.toBuffer()], vesting.programId);

  state.vestingConfigPda = vestingConfigPda.toBase58();
  state.vaultAuthorityPda = vaultAuthorityPda.toBase58();

  await vesting.methods.initialize()
    .accounts({
      config: vestingConfigPda, mint,
      admin: adminPubkey, systemProgram: SystemProgram.programId,
    }).rpc();
  console.log("  ✅ Vesting Program initialized");

  const vaultAtaKeypair = Keypair.generate();
  const vaultAta = vaultAtaKeypair.publicKey;
  state.vaultAta = vaultAta.toBase58();

  await vesting.methods.initializeVault()
    .accounts({
      config: vestingConfigPda, vaultAuthority: vaultAuthorityPda,
      vaultAta, mint, admin: adminPubkey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([vaultAtaKeypair])
    .rpc();
  console.log("  ✅ Vesting Vault ATA created");

  // Create vesting schedules (devnet: 테스트 수혜자 생성)
  const vestingSchedules = [
    { name: "earlyContrib", amount: DISTRIBUTION.earlyContrib.amount, cliff: CLIFF_1Y, linear: LINEAR_1Y },
    { name: "privateSale", amount: DISTRIBUTION.privateSale.amount, cliff: CLIFF_1Y, linear: LINEAR_1Y },
    { name: "teamAdvisor", amount: DISTRIBUTION.teamAdvisor.amount, cliff: CLIFF_1Y, linear: LINEAR_2Y },
  ];

  for (const schedule of vestingSchedules) {
    const beneficiary = Keypair.generate();
    const beneficiaryAta = (await getOrCreateAssociatedTokenAccount(
      connection, admin.payer, mint, beneficiary.publicKey
    )).address;

    const [vestingAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting"), beneficiary.publicKey.toBuffer()], vesting.programId
    );

    await vesting.methods.createVesting(
      new anchor.BN(schedule.amount),
      new anchor.BN(schedule.cliff),
      new anchor.BN(schedule.linear),
    ).accounts({
      config: vestingConfigPda, vestingAccount: vestingAccountPda,
      beneficiary: beneficiary.publicKey, vaultAta,
      adminAta, mint, admin: adminPubkey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).rpc();

    state.vestingAccounts[schedule.name] = {
      pda: vestingAccountPda.toBase58(),
      beneficiary: beneficiary.publicKey.toBase58(),
      amount: schedule.amount,
    };

    console.log(`  ✅ ${schedule.name}: ${schedule.amount.toLocaleString()} GNDK (cliff=${schedule.cliff}s, linear=${schedule.linear}s)`);
  }

  // ══════════════════════════════════════
  // Step 7: Verification
  // ══════════════════════════════════════
  console.log("\n━━━ Step 7: Verification ━━━");

  const poolBal = Number((await getAccount(connection, poolAta)).amount) / Number(DECIMALS_FACTOR);
  const d2eBal = Number((await getAccount(connection, d2ePoolAta)).amount) / Number(DECIMALS_FACTOR);
  const adminBal = Number((await getAccount(connection, adminAta)).amount) / Number(DECIMALS_FACTOR);
  const vaultBal = Number((await getAccount(connection, vaultAta)).amount) / Number(DECIMALS_FACTOR);

  const totalVested = vestingSchedules.reduce((s, v) => s + v.amount, 0);
  const totalAccounted = DISTRIBUTION.ecosystemReward.amount + totalVested + adminBal;

  console.log("  L2E RewardPool:", poolBal.toLocaleString(), "GNDK");
  console.log("  D2E BountyPool:", d2eBal.toLocaleString(), "GNDK (empty — B2B 매출 시 자연 축적)");
  console.log("  Vesting Vault: ", vaultBal.toLocaleString(), "GNDK");
  console.log("  Admin Wallet:  ", adminBal.toLocaleString(), "GNDK");
  console.log("  ────────────────────────────────────");
  console.log("  Total Accounted:", totalAccounted.toLocaleString(), "GNDK");
  console.log("  Expected:       ", TOTAL_SUPPLY.toLocaleString(), "GNDK");

  if (Math.abs(totalAccounted - TOTAL_SUPPLY) < 1) {
    console.log("  ✅ 분배 합계 검증 통과!");
  } else {
    console.log("  ⚠️  분배 합계 불일치! 확인 필요.");
  }

  const config = await registry.account.configAccount.fetch(configPda);
  console.log("\n  Registry Config:");
  console.log("    Phase:", config.currentPhase + 1);
  console.log("    Users:", config.totalRegisteredUsers.toNumber());
  console.log("    Paused:", config.isPaused);

  // ══════════════════════════════════════
  // Step 8: Authority Renounce (Devnet에서는 선택)
  // ══════════════════════════════════════
  if (process.argv.includes("--renounce")) {
    console.log("\n━━━ Step 8: Renounce Authorities ⚠️ ━━━");

    await setAuthority(connection, admin.payer, mint, adminPubkey, AuthorityType.MintTokens, null);
    state.mintAuthorityRenounced = true;
    console.log("  🔥 Mint Authority → RENOUNCED (영구 추가발행 불가)");

    await setAuthority(connection, admin.payer, mint, adminPubkey, AuthorityType.FreezeAccount, null);
    state.freezeAuthorityRenounced = true;
    console.log("  🔥 Freeze Authority → RENOUNCED (계정 동결 불가)");
  } else {
    console.log("\n━━━ Step 8: Authority Renounce SKIPPED ━━━");
    console.log("  💡 --renounce 플래그로 실행하면 Mint/Freeze Authority를 영구 포기합니다.");
    console.log("  💡 Devnet에서는 보통 유지 (재테스트 가능하도록)");
  }

  // ─── Save state ───
  saveState(state);

  // ══════════════════════════════════════
  // Summary
  // ══════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("║  TGE Devnet Deployment COMPLETE                    ║");
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Mint:          ", mint.toBase58());
  console.log("  Registry:      ", registry.programId.toBase58());
  console.log("  L2E Module:    ", l2e.programId.toBase58());
  console.log("  BurnRecycle:   ", burnRecycle.programId.toBase58());
  console.log("  Vesting:       ", vesting.programId.toBase58());
  console.log("  RewardPool ATA:", poolAta.toBase58());
  console.log("  State file:    ", STATE_FILE);
  console.log("═══════════════════════════════════════════════════════\n");

  if (USE_SHORT_VESTING) {
    console.log("  ⚡ --fast 모드: Vesting 기간 축소됨 (cliff=60s, linear=60~120s)");
  }
}

main().catch(err => {
  console.error("TGE Error:", err);
  process.exit(1);
});
