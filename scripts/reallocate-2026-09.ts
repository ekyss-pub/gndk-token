/**
 * GNDK — 2026-09 Allocation Change (Whitepaper v3.0 → v3.1)
 *
 *   Early Contributors  10% → 20%   (100M vested + 77M already paid from Squads + 23M new vesting)
 *   Private Sale        10% →  5%   (revoke 100M, re-create 50M under a new beneficiary)
 *   Marketing           15% → 10%   (27M returned to the Squads vault; 50M of the 77M paid-out
 *                                    is re-attributed from Marketing, 50M from Private Sale)
 *
 * On-chain steps (all signed by the vesting admin = deployer):
 *   1. revoke(privateSale)                → 100M back to admin ATA (cliff not passed → fully unvested)
 *   2. create_vesting(privateSale2,  50M) → cliff/linear aligned to the ORIGINAL privateSale dates
 *   3. create_vesting(earlyContrib2, 23M) → cliff/linear aligned to the ORIGINAL earlyContrib dates
 *   4. transfer 27M admin ATA → return vault ATA (mainnet: Squads master vault)
 *   5. verify: admin ATA back to its starting balance, vesting vault −27M, return vault +27M
 *
 * Every step is idempotent and checked on-chain, so the script can be re-run after a failure.
 * Default is DRY-RUN. Pass --execute to send transactions.
 *
 * Devnet rehearsal:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/dev/solana/dev-wallet.json \
 *   TGE_STATE=scripts/tge-devnet-state.json \
 *   KEYS_DIR=~/dev/solana/gndk-devnet-keys/vesting-beneficiaries \
 *   npx ts-node --project tsconfig.json scripts/reallocate-2026-09.ts [--execute]
 *
 * Mainnet:
 *   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
 *   ANCHOR_WALLET=~/dev/solana/deployer-mainnet.json \
 *   TGE_STATE=~/dev/solana/gndk-mainnet-keys/tge-mainnet-state.json \
 *   KEYS_DIR=~/dev/solana/gndk-mainnet-keys/vesting-beneficiaries \
 *   npx ts-node --project tsconfig.json scripts/reallocate-2026-09.ts [--execute]
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { VestingProgram } from "../target/types/vesting_program";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  transferChecked,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ════════════════════════════════════════
// Plan (GNDK units, decimals not applied)
// ════════════════════════════════════════

const REVOKE_NAME = "privateSale";
const REVOKE_EXPECTED = 100_000_000;

const NEW_SCHEDULES = [
  // name           amount       copy cliff/linear end dates from this ORIGINAL schedule
  { name: "privateSale2",  amount: 50_000_000, alignTo: "privateSale"  },
  { name: "earlyContrib2", amount: 23_000_000, alignTo: "earlyContrib" },
];
const RETURN_AMOUNT = 27_000_000;

const DECIMALS = 9;
const DECIMALS_FACTOR = BigInt(10 ** DECIMALS);

const PROGRAM_IDS: Record<string, string> = {
  devnet:  "6w23izAP5v6WzqA9eAgb96WvWtckKbquhKbPfXmgMwok",
  mainnet: "2H2nr7E2F4CFPEwacmAwtBu5YXjF5LjqrMXyt2phQWMq",
};

// ════════════════════════════════════════
// Helpers
// ════════════════════════════════════════

const EXECUTE = process.argv.includes("--execute");

function expand(p: string) { return p.replace(/^~/, os.homedir()); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function fmt(n: number | bigint) { return Number(n).toLocaleString("en-US"); }
function raw(gndk: number) { return BigInt(gndk) * DECIMALS_FACTOR; }
function toGndk(rawAmt: bigint) { return Number(rawAmt / DECIMALS_FACTOR); }
function iso(unix: number) { return new Date(unix * 1000).toISOString(); }
function tgeProgramIdFromState(p: string): string | undefined {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")).vestingProgramId; } catch { return undefined; }
}
function die(msg: string): never { console.error("\n❌ ABORT:", msg); process.exit(1); }

async function balance(connection: Connection, ata: PublicKey): Promise<bigint> {
  return (await getAccount(connection, ata)).amount;
}

function loadOrCreateKeypair(file: string): { kp: Keypair; created: boolean } {
  if (fs.existsSync(file)) {
    return { kp: Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(file, "utf-8")))), created: false };
  }
  const kp = Keypair.generate();
  if (EXECUTE) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  }
  return { kp, created: true };
}

// ════════════════════════════════════════
// Main
// ════════════════════════════════════════

async function main() {
  const rpc = process.env.ANCHOR_PROVIDER_URL || die("ANCHOR_PROVIDER_URL required");
  const cluster = rpc.includes("mainnet") ? "mainnet" : rpc.includes("devnet") ? "devnet" : die(`unknown cluster: ${rpc}`);
  const walletPath = expand(process.env.ANCHOR_WALLET || die("ANCHOR_WALLET required"));
  const statePath = expand(process.env.TGE_STATE || die("TGE_STATE required"));
  const keysDir = expand(process.env.KEYS_DIR || die("KEYS_DIR required"));
  const reallocStatePath = path.join(path.dirname(statePath), `reallocation-2026-09-${cluster}.json`);

  console.log("═══════════════════════════════════════════════════════");
  console.log(`  GNDK Reallocation 2026-09 — ${cluster.toUpperCase()} — ${EXECUTE ? "EXECUTE" : "DRY RUN"}`);
  console.log("═══════════════════════════════════════════════════════\n");

  // sanity: plan sums
  const planned = NEW_SCHEDULES.reduce((s, x) => s + x.amount, 0) + RETURN_AMOUNT;
  if (planned !== REVOKE_EXPECTED) die(`plan does not balance: ${planned} != ${REVOKE_EXPECTED}`);

  // ─── Setup ───
  const connection = new Connection(rpc, "confirmed");
  const walletKeypair = Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8"))));
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const admin = wallet.publicKey;

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "target", "idl", "vesting_program.json"), "utf-8"));
  // devnet rehearsal state carries its own program id (audited build redeployed under the mainnet id)
  idl.address = process.env.VESTING_PROGRAM_ID || tgeProgramIdFromState(statePath) || PROGRAM_IDS[cluster];
  const vesting = new Program<VestingProgram>(idl, provider);

  const tge = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  const mint = new PublicKey(tge.mint);
  const vaultAta = new PublicKey(tge.vaultAta);
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("vesting_config")], vesting.programId);
  const [vaultAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("vesting_vault"), mint.toBuffer()], vesting.programId);

  const realloc: any = fs.existsSync(reallocStatePath) ? JSON.parse(fs.readFileSync(reallocStatePath, "utf-8")) : { cluster, steps: {} };
  const saveRealloc = () => { if (EXECUTE) fs.writeFileSync(reallocStatePath, JSON.stringify(realloc, null, 2)); };

  console.log("RPC:            ", rpc);
  console.log("Vesting program:", vesting.programId.toBase58());
  console.log("Admin (signer): ", admin.toBase58());
  console.log("Mint:           ", mint.toBase58());
  console.log("Vesting vault:  ", vaultAta.toBase58());
  console.log("Config PDA:     ", configPda.toBase58());
  console.log("SOL balance:    ", (await connection.getBalance(admin)) / LAMPORTS_PER_SOL, "\n");

  // ─── Guards ───
  const config = await vesting.account.vestingConfig.fetch(configPda);
  if (!config.admin.equals(admin)) die(`wallet is not the vesting admin (config.admin=${config.admin.toBase58()})`);
  if (!config.mint.equals(mint)) die("config.mint != state.mint");

  const adminAta = (await getOrCreateAssociatedTokenAccount(connection, walletKeypair, mint, admin)).address;

  // return destination: mainnet = Squads vault ATA from TGE state; devnet = RETURN_OWNER env or throwaway
  let returnAta: PublicKey;
  if (cluster === "mainnet") {
    if (!tge.squadsVaultAta) die("state.squadsVaultAta missing");
    returnAta = new PublicKey(tge.squadsVaultAta);
  } else {
    const ownerFile = path.join(keysDir, "..", "return-vault-owner-keypair.json");
    const { kp: owner } = loadOrCreateKeypair(ownerFile);
    returnAta = EXECUTE
      ? (await getOrCreateAssociatedTokenAccount(connection, walletKeypair, mint, owner.publicKey)).address
      : owner.publicKey; // placeholder in dry-run
    console.log("Return vault (devnet throwaway owner):", owner.publicKey.toBase58());
  }
  console.log("Return ATA:     ", returnAta.toBase58());

  // ─── Original schedules ───
  const orig: Record<string, any> = {};
  for (const name of Object.keys(tge.vestingAccounts)) {
    const pda = new PublicKey(tge.vestingAccounts[name].pda);
    const acct = await vesting.account.vestingAccount.fetch(pda);
    orig[name] = { pda, acct };
  }

  console.log("\n── Current vesting schedules ──");
  for (const [name, { pda, acct }] of Object.entries(orig)) {
    console.log(`  ${name.padEnd(14)} ${fmt(acct.totalAmount.toNumber()).padStart(13)} GNDK  claimed=${acct.claimedAmount.toNumber()}  revoked=${acct.revoked}`);
    console.log(`  ${"".padEnd(14)} cliffEnd=${iso(acct.cliffEnd.toNumber())}  vestingEnd=${iso(acct.vestingEnd.toNumber())}`);
  }

  const bal0 = { admin: await balance(connection, adminAta), vault: await balance(connection, vaultAta) };
  console.log("\n── Balances (before) ──");
  console.log(`  admin ATA:     ${fmt(toGndk(bal0.admin))}`);
  console.log(`  vesting vault: ${fmt(toGndk(bal0.vault))}`);

  // on-chain time (for aligning new schedules to the original end dates)
  const slot = await connection.getSlot();
  const now = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);

  // ─── Plan ───
  const target = orig[REVOKE_NAME] ?? die(`no original schedule named ${REVOKE_NAME}`);
  const targetTotal = target.acct.totalAmount.toNumber();
  const alreadyRevoked = target.acct.revoked as boolean;
  if (!alreadyRevoked) {
    if (targetTotal !== REVOKE_EXPECTED) die(`${REVOKE_NAME} total=${targetTotal}, expected ${REVOKE_EXPECTED}`);
    if (target.acct.claimedAmount.toNumber() !== 0) die(`${REVOKE_NAME} has claims`);
    if (now >= target.acct.cliffEnd.toNumber()) die("cliff already passed — partial vesting would break the 100M assumption");
  }

  console.log("\n── Plan ──");
  console.log(`  1. revoke ${REVOKE_NAME} (${fmt(REVOKE_EXPECTED)}) ${alreadyRevoked ? "— already revoked, skip" : ""}`);
  const plans: any[] = [];
  for (const s of NEW_SCHEDULES) {
    const src = orig[s.alignTo] ?? die(`alignTo ${s.alignTo} not found`);
    const cliffDur = src.acct.cliffEnd.toNumber() - now;
    const linearDur = src.acct.vestingEnd.toNumber() - src.acct.cliffEnd.toNumber();
    if (cliffDur < 0 || linearDur <= 0) die(`bad durations for ${s.name}`);
    const keyFile = path.join(keysDir, `${s.name}-keypair.json`);
    const { kp, created } = loadOrCreateKeypair(keyFile);
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("vesting"), kp.publicKey.toBuffer()], vesting.programId);
    const exists = (await connection.getAccountInfo(pda)) !== null;
    plans.push({ ...s, kp, keyFile, created, pda, cliffDur, linearDur, exists });
    console.log(`  ${plans.length + 1}. create_vesting ${s.name} ${fmt(s.amount)} GNDK  cliff=${cliffDur}s (→ ${iso(now + cliffDur)})  linear=${linearDur}s (→ ${iso(now + cliffDur + linearDur)})`);
    console.log(`     beneficiary ${kp.publicKey.toBase58()} (${created ? "NEW key → " + keyFile : "existing key"})  pda ${pda.toBase58()} ${exists ? "— already exists, skip" : ""}`);
  }
  console.log(`  ${plans.length + 2}. transfer ${fmt(RETURN_AMOUNT)} GNDK admin → return vault ${realloc.steps.returned ? "— already done, skip" : ""}`);

  if (!EXECUTE) {
    console.log("\nDRY RUN — nothing sent. Re-run with --execute.");
    return;
  }

  // ════════════════════════════════════════
  // Execute
  // ════════════════════════════════════════
  console.log("\n── Executing ──");

  // 1. revoke
  if (!alreadyRevoked) {
    const before = await balance(connection, adminAta);
    const sig = await vesting.methods.revoke().accounts({
      config: configPda, vestingAccount: target.pda, vaultAuthority: vaultAuthorityPda,
      vaultAta, mint, adminAta, admin, tokenProgram: TOKEN_PROGRAM_ID,
    } as any).rpc();
    const after = await balance(connection, adminAta);
    const got = toGndk(after - before);
    console.log(`  revoke ${REVOKE_NAME}: +${fmt(got)} GNDK to admin  tx=${sig}`);
    realloc.steps.revoke = { name: REVOKE_NAME, pda: target.pda.toBase58(), returned: got, tx: sig, at: new Date().toISOString() };
    saveRealloc();
    if (got !== REVOKE_EXPECTED) die(`revoke returned ${got}, expected ${REVOKE_EXPECTED} — stop and inspect`);
    await sleep(2000);
  }

  // 2-3. create new schedules
  realloc.steps.created = realloc.steps.created || {};
  for (const p of plans) {
    if (p.exists) continue;
    const have = toGndk(await balance(connection, adminAta));
    if (have < p.amount) die(`admin ATA has ${have}, needs ${p.amount} for ${p.name}`);
    await getOrCreateAssociatedTokenAccount(connection, walletKeypair, mint, p.kp.publicKey); // beneficiary ATA for future claims
    const sig = await vesting.methods
      .createVesting(new BN(p.amount), new BN(p.cliffDur), new BN(p.linearDur))
      .accounts({
        config: configPda, vestingAccount: p.pda, beneficiary: p.kp.publicKey,
        vaultAta, adminAta, mint, vaultAuthority: vaultAuthorityPda, admin,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any).rpc();
    const acct = await vesting.account.vestingAccount.fetch(p.pda);
    console.log(`  create ${p.name}: ${fmt(p.amount)} GNDK  cliffEnd=${iso(acct.cliffEnd.toNumber())}  vestingEnd=${iso(acct.vestingEnd.toNumber())}  tx=${sig}`);
    realloc.steps.created[p.name] = {
      pda: p.pda.toBase58(), beneficiary: p.kp.publicKey.toBase58(), keyFile: p.keyFile, amount: p.amount,
      cliffEnd: acct.cliffEnd.toNumber(), vestingEnd: acct.vestingEnd.toNumber(), tx: sig, at: new Date().toISOString(),
    };
    saveRealloc();
    await sleep(2000);
  }

  // 4. return to vault
  if (!realloc.steps.returned) {
    const have = toGndk(await balance(connection, adminAta));
    if (have < RETURN_AMOUNT) die(`admin ATA has ${have}, needs ${RETURN_AMOUNT} to return`);
    const sig = await transferChecked(connection, walletKeypair, adminAta, mint, returnAta, walletKeypair, raw(RETURN_AMOUNT), DECIMALS);
    console.log(`  return ${fmt(RETURN_AMOUNT)} GNDK → ${returnAta.toBase58()}  tx=${sig}`);
    realloc.steps.returned = { to: returnAta.toBase58(), amount: RETURN_AMOUNT, tx: sig, at: new Date().toISOString() };
    saveRealloc();
  }

  // 5. verify
  await sleep(2000);
  const bal1 = { admin: await balance(connection, adminAta), vault: await balance(connection, vaultAta), ret: await balance(connection, returnAta) };
  console.log("\n── Balances (after) ──");
  console.log(`  admin ATA:     ${fmt(toGndk(bal1.admin))}  (before ${fmt(toGndk(bal0.admin))})`);
  console.log(`  vesting vault: ${fmt(toGndk(bal1.vault))}  (before ${fmt(toGndk(bal0.vault))})`);
  console.log(`  return vault:  ${fmt(toGndk(bal1.ret))}`);
  console.log("\n── Vesting schedules (after) ──");
  const all = { ...tge.vestingAccounts, ...Object.fromEntries(Object.entries(realloc.steps.created).map(([k, v]: any) => [k, { pda: v.pda }])) };
  let vaultExpected = 0;
  for (const name of Object.keys(all)) {
    const acct = await vesting.account.vestingAccount.fetch(new PublicKey(all[name].pda));
    const outstanding = acct.totalAmount.toNumber() - acct.claimedAmount.toNumber();
    vaultExpected += outstanding;
    console.log(`  ${name.padEnd(14)} ${fmt(acct.totalAmount.toNumber()).padStart(13)} GNDK  revoked=${acct.revoked}  cliffEnd=${iso(acct.cliffEnd.toNumber())}  vestingEnd=${iso(acct.vestingEnd.toNumber())}`);
  }
  const ok = toGndk(bal1.vault) === vaultExpected && bal1.admin === bal0.admin;
  console.log(`\n  vault == sum(outstanding schedules) = ${fmt(vaultExpected)} : ${toGndk(bal1.vault) === vaultExpected ? "OK" : "MISMATCH"}`);
  console.log(`  admin ATA unchanged from start: ${bal1.admin === bal0.admin ? "OK" : "MISMATCH"}`);
  realloc.verified = ok;
  realloc.completedAt = new Date().toISOString();
  saveRealloc();
  console.log(`\n${ok ? "✅ DONE" : "⚠️ DONE WITH MISMATCH — inspect"}  state: ${reallocStatePath}`);
  if (!ok) process.exit(2);
}

main().catch(e => { console.error(e); process.exit(1); });
