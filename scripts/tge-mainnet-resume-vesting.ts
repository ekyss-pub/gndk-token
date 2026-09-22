/**
 * GNDK TGE Resume — Step 6: Vesting Only
 *
 * Steps 1-5 completed. This script resumes from Step 6 (Vesting).
 * Adds delays between transactions to avoid RPC rate limits.
 *
 * Run:
 *   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
 *   ANCHOR_WALLET=~/dev/solana/deployer-mainnet.json \
 *   npx ts-node --project tsconfig.json scripts/tge-mainnet-resume-vesting.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { VestingProgram } from "../target/types/vesting_program";
import { GndkRegistry } from "../target/types/gndk_registry";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAccount,
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
// Known state from Steps 1-5
// ════════════════════════════════════════

const MINT = new PublicKey("fksRmeMUXV3o3UzFtJ48BpoQoKkUhrYyXpCzXmsR3EF");
const SQUADS_VAULT = new PublicKey("6YZBADsF1M2TAKLdPgXXED6pGxrAoy5sirA1S4kCyLWy");
const ORACLE_SECRET = ""; // Will be filled if needed

const DECIMALS = 9;
const DECIMALS_FACTOR = BigInt(10 ** DECIMALS);
const YEAR_SECONDS = Math.floor(365.25 * 24 * 3600);

const VESTING_SCHEDULES = [
  { name: "earlyContrib", amount: 100_000_000, cliffYears: 1, linearYears: 1 },
  { name: "privateSale",  amount: 100_000_000, cliffYears: 1, linearYears: 1 },
  { name: "teamAdvisor",  amount:  50_000_000, cliffYears: 1, linearYears: 2 },
];

const STATE_FILE = path.join(__dirname, "tge-mainnet-state.json");

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  GNDK TGE Resume — Step 6: Vesting");
  console.log("═══════════════════════════════════════════════════════\n");

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
  const vesting = anchor.workspace.vestingProgram as Program<VestingProgram>;

  console.log("Admin:", adminPubkey.toBase58());
  console.log("Mint:", MINT.toBase58());
  const balance = await connection.getBalance(adminPubkey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL\n");

  // Admin ATA (has remaining 250M GNDK for vesting)
  const adminAta = (await getOrCreateAssociatedTokenAccount(
    connection, admin.payer, MINT, adminPubkey
  )).address;

  const adminBal = Number((await getAccount(connection, adminAta)).amount) / Number(DECIMALS_FACTOR);
  console.log("Admin GNDK balance:", adminBal.toLocaleString());

  if (adminBal < 250_000_000) {
    console.log("  ERROR: Not enough GNDK for vesting (need 250M, have " + adminBal.toLocaleString() + ")");
    return;
  }

  // ══════════════════════════════════════
  // Step 6: Initialize Vesting + Create Schedules
  // ══════════════════════════════════════
  console.log("\n--- Step 6: Vesting Program ---");

  // 6a. Initialize vesting program
  console.log("  Initializing vesting program...");
  await sleep(3000);
  await (vesting.methods as any).initialize()
    .accounts({
      mint: MINT, admin: adminPubkey,
      systemProgram: SystemProgram.programId,
    }).rpc();
  console.log("  Vesting Program initialized");

  // 6b. Create vault ATA
  await sleep(3000);
  const vaultAtaKeypair = Keypair.generate();
  const vaultAta = vaultAtaKeypair.publicKey;

  await (vesting.methods as any).initializeVault()
    .accounts({
      vaultAta, mint: MINT, admin: adminPubkey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([vaultAtaKeypair])
    .rpc();
  console.log("  Vesting Vault ATA created:", vaultAta.toBase58());

  // 6c. Create vesting schedules
  const beneficiaryKeysDir = path.join(__dirname, "..", "keys", "mainnet", "vesting-beneficiaries");
  if (!fs.existsSync(beneficiaryKeysDir)) {
    fs.mkdirSync(beneficiaryKeysDir, { recursive: true });
  }

  const vestingAccounts: Record<string, any> = {};

  for (const schedule of VESTING_SCHEDULES) {
    await sleep(5000); // Longer delay between vesting creates

    const beneficiary = Keypair.generate();
    const cliffSec = schedule.cliffYears * YEAR_SECONDS;
    const linearSec = schedule.linearYears * YEAR_SECONDS;

    // Save beneficiary keypair
    fs.writeFileSync(
      path.join(beneficiaryKeysDir, `${schedule.name}-keypair.json`),
      JSON.stringify(Array.from(beneficiary.secretKey))
    );

    await sleep(2000);
    const beneficiaryAta = (await getOrCreateAssociatedTokenAccount(
      connection, admin.payer, MINT, beneficiary.publicKey
    )).address;

    const [vestingAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting"), beneficiary.publicKey.toBuffer()], vesting.programId
    );

    await sleep(2000);
    await (vesting.methods as any).createVesting(
      new anchor.BN(schedule.amount),
      new anchor.BN(cliffSec),
      new anchor.BN(linearSec),
    ).accounts({
      beneficiary: beneficiary.publicKey, vaultAta,
      adminAta, mint: MINT, admin: adminPubkey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).rpc();

    vestingAccounts[schedule.name] = {
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
  await sleep(3000);

  const poolAta = (await registry.account.configAccount.fetch(
    PublicKey.findProgramAddressSync([Buffer.from("config")], registry.programId)[0]
  ));

  const finalAdminBal = Number((await getAccount(connection, adminAta)).amount) / Number(DECIMALS_FACTOR);
  const vaultBal = Number((await getAccount(connection, vaultAta)).amount) / Number(DECIMALS_FACTOR);

  const squadsVaultAta = (await getOrCreateAssociatedTokenAccount(
    connection, admin.payer, MINT, SQUADS_VAULT, true
  )).address;
  const squadsVaultBal = Number((await getAccount(connection, squadsVaultAta)).amount) / Number(DECIMALS_FACTOR);

  console.log("  Vesting Vault:   ", vaultBal.toLocaleString(), "GNDK");
  console.log("  Squads Vault:    ", squadsVaultBal.toLocaleString(), "GNDK");
  console.log("  Admin Wallet:    ", finalAdminBal.toLocaleString(), "GNDK");

  if (Math.abs(finalAdminBal) < 1) {
    console.log("  Admin balance is 0 — all tokens distributed!");
  }

  // Save full state
  const state = {
    network: connection.rpcEndpoint,
    timestamp: new Date().toISOString(),
    mint: MINT.toBase58(),
    adminWallet: adminPubkey.toBase58(),
    squadsVault: SQUADS_VAULT.toBase58(),
    squadsVaultAta: squadsVaultAta.toBase58(),
    vaultAta: vaultAta.toBase58(),
    vestingAccounts,
    vaultDistribution: {
      foundation: 180_000_000,
      marketing: 150_000_000,
      partnerships: 70_000_000,
      charitable: 50_000_000,
    },
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log("  State saved to", STATE_FILE);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  TGE Step 6 (Vesting) COMPLETE");
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
