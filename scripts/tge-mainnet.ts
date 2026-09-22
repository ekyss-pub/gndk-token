/**
 * GNDK Token — TGE Mainnet Deployment Script
 *
 * Whitepaper v3.0 (2026-04-03) Token Distribution
 *
 * Run:
 *   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
 *   ANCHOR_WALLET=~/dev/solana/deployer-mainnet.json \
 *   npx ts-node --project tsconfig.json scripts/tge-mainnet.ts
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
// Configuration
// ════════════════════════════════════════

const TOTAL_SUPPLY = 1_000_000_000;
const DECIMALS = 9;
const DECIMALS_FACTOR = BigInt(10 ** DECIMALS);

const SQUADS_VAULT = new PublicKey("6YZBADsF1M2TAKLdPgXXED6pGxrAoy5sirA1S4kCyLWy");

// Whitepaper v3.0 Distribution
const REWARD_POOL_AMOUNT = 300_000_000;  // MYPOOL 120M + Ganadara 180M
const VAULT_TOTAL = 450_000_000;         // Foundation 180M + Marketing 150M + Partnerships 70M + Charitable 50M
const VESTING_TOTAL = 250_000_000;       // Early 100M + Private 100M + Team 50M

const VESTING_SCHEDULES = [
  { name: "earlyContrib", amount: 100_000_000, cliffYears: 1, linearYears: 1 },
  { name: "privateSale",  amount: 100_000_000, cliffYears: 1, linearYears: 1 },
  { name: "teamAdvisor",  amount:  50_000_000, cliffYears: 1, linearYears: 2 },
];

const YEAR_SECONDS = Math.floor(365.25 * 24 * 3600);

// ════════════════════════════════════════
// State file
// ════════════════════════════════════════

const STATE_FILE = path.join(__dirname, "tge-mainnet-state.json");

function saveState(state: any) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`  State saved to ${STATE_FILE}`);
}

// ════════════════════════════════════════
// Main
// ════════════════════════════════════════

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  GNDK Token — TGE MAINNET Deployment");
  console.log("  Whitepaper v3.0 (2026-04-03)");
  console.log("═══════════════════════════════════════════════════════\n");

  // ─── Setup ───
  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.mainnet-beta.solana.com",
    "confirmed"
  );
  const walletPath = process.env.ANCHOR_WALLET
    || path.join(process.env.HOME!, "dev/solana/deployer-mainnet.json");
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const admin = wallet;
  const adminPubkey = admin.publicKey;

  const registry = anchor.workspace.gndkRegistry as Program<GndkRegistry>;
  const l2e = anchor.workspace.l2eModule as Program<L2eModule>;
  const burnRecycle = anchor.workspace.burnRecycle as Program<BurnRecycle>;
  const vesting = anchor.workspace.vestingProgram as Program<VestingProgram>;

  console.log("Network:", connection.rpcEndpoint);
  console.log("Admin:", adminPubkey.toBase58());
  console.log("Squads Vault:", SQUADS_VAULT.toBase58());
  console.log("Programs:");
  console.log("  Registry:", registry.programId.toBase58());
  console.log("  L2E:     ", l2e.programId.toBase58());
  console.log("  Burn:    ", burnRecycle.programId.toBase58());
  console.log("  Vesting: ", vesting.programId.toBase58());

  const balance = await connection.getBalance(adminPubkey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL\n");

  if (balance < 2 * LAMPORTS_PER_SOL) {
    console.log("  SOL balance too low. Need at least 2 SOL.");
    return;
  }

  // Safety confirmation
  process.stdout.write("  MAINNET TGE: 1B GNDK tokens. Continue? (y/N): ");
  const answer = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data) => resolve(data.toString().trim().toLowerCase()));
  });
  if (answer !== "y") { console.log("  Aborted."); return; }

  // Oracle keypair
  const oracle = Keypair.generate();
  console.log("\n  Oracle pubkey:", oracle.publicKey.toBase58());

  const state: any = {
    network: connection.rpcEndpoint,
    timestamp: new Date().toISOString(),
    adminWallet: adminPubkey.toBase58(),
    oracleKeypair: Buffer.from(oracle.secretKey).toString("base64"),
    squadsVault: SQUADS_VAULT.toBase58(),
  };

  // ══════════════════════════════════════
  // Step 1: Create SPL Token (GNDK)
  // ══════════════════════════════════════
  console.log("\n--- Step 1: Create GNDK SPL Token ---");

  const mint = await createMint(
    connection, admin.payer, adminPubkey, adminPubkey,
    DECIMALS, undefined, undefined, TOKEN_PROGRAM_ID
  );
  state.mint = mint.toBase58();
  console.log("  Mint:", mint.toBase58());

  const adminAta = (await getOrCreateAssociatedTokenAccount(
    connection, admin.payer, mint, adminPubkey
  )).address;

  await mintTo(
    connection, admin.payer, mint, adminAta, adminPubkey,
    BigInt(TOTAL_SUPPLY) * DECIMALS_FACTOR
  );
  console.log("  Minted:", TOTAL_SUPPLY.toLocaleString(), "GNDK to admin");

  // ══════════════════════════════════════
  // Step 2: Initialize Registry
  // ══════════════════════════════════════
  console.log("\n--- Step 2: Initialize Registry ---");

  // 2a. Initialize config (PDA accounts auto-resolved)
  await (registry.methods as any).initialize(oracle.publicKey)
    .accounts({ mint, admin: adminPubkey, systemProgram: SystemProgram.programId })
    .rpc();
  console.log("  ConfigAccount initialized");

  // Derive PDAs for state tracking
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")], registry.programId);
  const [poolAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reward_pool"), mint.toBuffer()], registry.programId);
  const [d2ePoolAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("d2e_pool"), mint.toBuffer()], registry.programId);

  state.configPda = configPda.toBase58();
  state.poolAuthorityPda = poolAuthorityPda.toBase58();
  state.d2ePoolAuthorityPda = d2ePoolAuthorityPda.toBase58();

  // 2b. Initialize L2E RewardPool
  const poolAtaKeypair = Keypair.generate();
  const poolAta = poolAtaKeypair.publicKey;
  state.poolAta = poolAta.toBase58();

  await (registry.methods as any).initializeRewardPool()
    .accounts({
      rewardPoolAta: poolAta, mint,
      admin: adminPubkey, tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([poolAtaKeypair])
    .rpc();
  console.log("  L2E RewardPool ATA created");

  // 2c. Initialize D2E BountyPool
  const d2ePoolAtaKeypair = Keypair.generate();
  const d2ePoolAta = d2ePoolAtaKeypair.publicKey;
  state.d2ePoolAta = d2ePoolAta.toBase58();

  await (registry.methods as any).initializeD2EPool()
    .accounts({
      d2EPoolAta: d2ePoolAta, mint,
      admin: adminPubkey, tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([d2ePoolAtaKeypair])
    .rpc();
  console.log("  D2E BountyPool ATA created (empty)");

  // 2d. Initialize BurnStats
  await (registry.methods as any).initializeBurnStats()
    .accounts({ admin: adminPubkey, systemProgram: SystemProgram.programId })
    .rpc();
  console.log("  BurnStats initialized");

  // ══════════════════════════════════════
  // Step 3: Token Distribution
  // ══════════════════════════════════════
  console.log("\n--- Step 3: Token Distribution ---");

  // 3a. Fund L2E RewardPool (300M)
  const fundPoolIx = createTransferInstruction(
    adminAta, poolAta, adminPubkey,
    BigInt(REWARD_POOL_AMOUNT) * DECIMALS_FACTOR
  );
  await provider.sendAndConfirm(new anchor.web3.Transaction().add(fundPoolIx));
  console.log("  RewardPool: 300,000,000 GNDK (MYPOOL 120M + Ganadara 180M)");

  // 3b. Transfer 450M to Squads Master Vault
  const squadsVaultAta = (await getOrCreateAssociatedTokenAccount(
    connection, admin.payer, mint, SQUADS_VAULT, true
  )).address;
  state.squadsVaultAta = squadsVaultAta.toBase58();

  const fundVaultIx = createTransferInstruction(
    adminAta, squadsVaultAta, adminPubkey,
    BigInt(VAULT_TOTAL) * DECIMALS_FACTOR
  );
  await provider.sendAndConfirm(new anchor.web3.Transaction().add(fundVaultIx));
  console.log("  Squads Vault: 450,000,000 GNDK");
  console.log("    Foundation:   180,000,000");
  console.log("    Marketing:    150,000,000");
  console.log("    Partnerships:  70,000,000");
  console.log("    Charitable:    50,000,000");

  // ══════════════════════════════════════
  // Step 4: Initialize L2E Module
  // ══════════════════════════════════════
  console.log("\n--- Step 4: Initialize L2E Module ---");

  const [l2eModulePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("module"), l2e.programId.toBuffer()], registry.programId);

  await (l2e.methods as any).initialize()
    .accounts({
      oracle: oracle.publicKey, mint,
      admin: adminPubkey, systemProgram: SystemProgram.programId,
    }).rpc();
  console.log("  L2E Module initialized");

  await (registry.methods as any).registerModule("l2e-module", 0, new anchor.BN(10000), new anchor.BN(0))
    .accounts({
      moduleProgram: l2e.programId,
      admin: adminPubkey, systemProgram: SystemProgram.programId,
    }).rpc();
  console.log("  L2E Module registered in Registry");

  // ══════════════════════════════════════
  // Step 5: Initialize BurnRecycle
  // ══════════════════════════════════════
  console.log("\n--- Step 5: Initialize BurnRecycle ---");

  await (burnRecycle.methods as any).initialize(poolAta)
    .accounts({
      mint, admin: adminPubkey,
      systemProgram: SystemProgram.programId,
    }).rpc();
  console.log("  BurnRecycle initialized (50% burn + 50% recycle)");

  // ══════════════════════════════════════
  // Step 6: Vesting Program
  // ══════════════════════════════════════
  console.log("\n--- Step 6: Vesting Program ---");

  await (vesting.methods as any).initialize()
    .accounts({
      mint, admin: adminPubkey,
      systemProgram: SystemProgram.programId,
    }).rpc();
  console.log("  Vesting Program initialized");

  const vaultAtaKeypair = Keypair.generate();
  const vaultAta = vaultAtaKeypair.publicKey;
  state.vaultAta = vaultAta.toBase58();

  await (vesting.methods as any).initializeVault()
    .accounts({
      vaultAta, mint, admin: adminPubkey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([vaultAtaKeypair])
    .rpc();
  console.log("  Vesting Vault ATA created");

  // Create vesting schedules with generated beneficiaries
  const beneficiaryKeysDir = path.join(__dirname, "..", "keys", "mainnet", "vesting-beneficiaries");
  if (!fs.existsSync(beneficiaryKeysDir)) {
    fs.mkdirSync(beneficiaryKeysDir, { recursive: true });
  }

  state.vestingAccounts = {};

  for (const schedule of VESTING_SCHEDULES) {
    const beneficiary = Keypair.generate();
    const cliffSec = schedule.cliffYears * YEAR_SECONDS;
    const linearSec = schedule.linearYears * YEAR_SECONDS;

    // Save beneficiary keypair
    fs.writeFileSync(
      path.join(beneficiaryKeysDir, `${schedule.name}-keypair.json`),
      JSON.stringify(Array.from(beneficiary.secretKey))
    );

    const beneficiaryAta = (await getOrCreateAssociatedTokenAccount(
      connection, admin.payer, mint, beneficiary.publicKey
    )).address;

    const [vestingAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting"), beneficiary.publicKey.toBuffer()], vesting.programId
    );

    await (vesting.methods as any).createVesting(
      new anchor.BN(schedule.amount),
      new anchor.BN(cliffSec),
      new anchor.BN(linearSec),
    ).accounts({
      beneficiary: beneficiary.publicKey, vaultAta,
      adminAta, mint, admin: adminPubkey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).rpc();

    state.vestingAccounts[schedule.name] = {
      pda: vestingAccountPda.toBase58(),
      beneficiary: beneficiary.publicKey.toBase58(),
      amount: schedule.amount,
      cliffYears: schedule.cliffYears,
      linearYears: schedule.linearYears,
    };

    console.log(`  ${schedule.name}: ${schedule.amount.toLocaleString()} GNDK (cliff=${schedule.cliffYears}yr, linear=${schedule.linearYears}yr)`);
    console.log(`    beneficiary: ${beneficiary.publicKey.toBase58()}`);
  }
  console.log("  Beneficiary keypairs saved to:", beneficiaryKeysDir);

  // ══════════════════════════════════════
  // Step 7: Verification
  // ══════════════════════════════════════
  console.log("\n--- Step 7: Verification ---");

  const poolBal = Number((await getAccount(connection, poolAta)).amount) / Number(DECIMALS_FACTOR);
  const d2eBal = Number((await getAccount(connection, d2ePoolAta)).amount) / Number(DECIMALS_FACTOR);
  const adminBal = Number((await getAccount(connection, adminAta)).amount) / Number(DECIMALS_FACTOR);
  const vaultBal = Number((await getAccount(connection, vaultAta)).amount) / Number(DECIMALS_FACTOR);
  const squadsVaultBal = Number((await getAccount(connection, squadsVaultAta)).amount) / Number(DECIMALS_FACTOR);

  const totalAccounted = poolBal + vaultBal + squadsVaultBal + adminBal;

  console.log("  L2E RewardPool:  ", poolBal.toLocaleString(), "GNDK");
  console.log("  D2E BountyPool:  ", d2eBal.toLocaleString(), "GNDK");
  console.log("  Vesting Vault:   ", vaultBal.toLocaleString(), "GNDK");
  console.log("  Squads Vault:    ", squadsVaultBal.toLocaleString(), "GNDK");
  console.log("  Admin Wallet:    ", adminBal.toLocaleString(), "GNDK");
  console.log("  ────────────────────────────────────");
  console.log("  Total Accounted: ", totalAccounted.toLocaleString(), "GNDK");
  console.log("  Expected:        ", TOTAL_SUPPLY.toLocaleString(), "GNDK");

  if (Math.abs(totalAccounted - TOTAL_SUPPLY) < 1) {
    console.log("  Distribution verification PASSED");
  } else {
    console.log("  WARNING: Distribution mismatch!");
  }

  const config = await registry.account.configAccount.fetch(configPda);
  console.log("\n  Registry Config:");
  console.log("    Phase:", config.currentPhase + 1);
  console.log("    Users:", config.totalRegisteredUsers.toNumber());
  console.log("    Paused:", config.globalPause);

  // ══════════════════════════════════════
  // Step 8: Mint Authority
  // ══════════════════════════════════════
  console.log("\n--- Step 8: Mint Authority ---");
  console.log("  Mint Authority remains with Deployer.");
  console.log("  Will be disabled via Squads 2/2 after Keystone migration (~4/10).");

  // Save state
  saveState(state);

  // Summary
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  TGE MAINNET Deployment COMPLETE");
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Mint:           ", mint.toBase58());
  console.log("  RewardPool ATA: ", poolAta.toBase58());
  console.log("  Squads Vault:   ", SQUADS_VAULT.toBase58());
  console.log("  State file:     ", STATE_FILE);
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(err => {
  console.error("TGE Error:", err);
  process.exit(1);
});
