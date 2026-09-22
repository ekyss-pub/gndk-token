/**
 * Devnet rehearsal setup for reallocate-2026-09.ts
 *
 * The devnet TGE (2026-03-17) used 60-second cliffs, so those schedules are fully vested and
 * cannot stand in for mainnet. This creates fresh schedules on devnet that mirror mainnet:
 *   earlyContrib 100M / privateSale 100M — cliffEnd 2027-04-04, linear 1 year
 * under NEW beneficiary keys, and writes a TGE-state-shaped file for the reallocation script.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/dev/solana/dev-wallet.json \
 *   npx ts-node --project tsconfig.json scripts/rehearsal-setup-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { VestingProgram } from "../target/types/vesting_program";
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Connection } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const MAINNET_CLIFF_END = Math.floor(Date.parse("2027-04-04T07:15:27Z") / 1000); // mainnet TGE + 1y (365.25d)
const YEAR_SECONDS = Math.floor(365.25 * 24 * 3600);
const SCHEDULES = [
  { name: "earlyContrib", amount: 100_000_000 },
  { name: "privateSale",  amount: 100_000_000 },
];

async function main() {
  const connection = new Connection(process.env.ANCHOR_PROVIDER_URL!, "confirmed");
  const walletPath = (process.env.ANCHOR_WALLET!).replace(/^~/, os.homedir());
  const walletKeypair = Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8"))));
  const provider = new AnchorProvider(connection, new anchor.Wallet(walletKeypair), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const admin = walletKeypair.publicKey;

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "target", "idl", "vesting_program.json"), "utf-8"));
  // audited mainnet build deployed to devnet under the mainnet program id (2026-09-22)
  idl.address = "2H2nr7E2F4CFPEwacmAwtBu5YXjF5LjqrMXyt2phQWMq";
  const vesting = new Program<VestingProgram>(idl, provider);

  const tge = JSON.parse(fs.readFileSync(path.join(__dirname, "tge-devnet-state.json"), "utf-8"));
  const mint = new PublicKey(tge.mint);
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("vesting_config")], vesting.programId);
  const [vaultAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("vesting_vault"), mint.toBuffer()], vesting.programId);
  const adminAta = (await getOrCreateAssociatedTokenAccount(connection, walletKeypair, mint, admin)).address;

  // fresh program on devnet → initialize config + vault (same sequence as tge-mainnet.ts Step 6)
  const rehearsalPath = path.join(__dirname, "rehearsal-devnet-state.json");
  const prev = fs.existsSync(rehearsalPath) ? JSON.parse(fs.readFileSync(rehearsalPath, "utf-8")) : null;
  let vaultAta: PublicKey;
  if (prev?.vaultAta && prev.vestingProgramId === idl.address) {
    vaultAta = new PublicKey(prev.vaultAta);
    console.log("config/vault already initialized, vault =", vaultAta.toBase58());
  } else {
    await vesting.methods.initialize().accounts({ mint, admin, systemProgram: SystemProgram.programId } as any).rpc();
    const vaultAtaKeypair = Keypair.generate();
    vaultAta = vaultAtaKeypair.publicKey;
    await vesting.methods.initializeVault().accounts({
      vaultAta, mint, admin, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    } as any).signers([vaultAtaKeypair]).rpc();
    console.log("initialized config + vault", vaultAta.toBase58());
  }

  const keysDir = path.join(os.homedir(), "dev/solana/gndk-devnet-keys/vesting-beneficiaries");
  fs.mkdirSync(keysDir, { recursive: true });

  const slot = await connection.getSlot();
  const now = (await connection.getBlockTime(slot))!;
  const cliffDur = MAINNET_CLIFF_END - now;

  const state: any = { network: connection.rpcEndpoint, rehearsal: true, timestamp: new Date().toISOString(),
    vestingProgramId: idl.address, mint: tge.mint, vaultAta: vaultAta.toBase58(), vestingAccounts: {} };

  for (const s of SCHEDULES) {
    const b = Keypair.generate();
    fs.writeFileSync(path.join(keysDir, `${s.name}-keypair.json`), JSON.stringify(Array.from(b.secretKey)), { mode: 0o600 });
    await getOrCreateAssociatedTokenAccount(connection, walletKeypair, mint, b.publicKey);
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("vesting"), b.publicKey.toBuffer()], vesting.programId);
    const sig = await vesting.methods.createVesting(new BN(s.amount), new BN(cliffDur), new BN(YEAR_SECONDS)).accounts({
      config: configPda, vestingAccount: pda, beneficiary: b.publicKey, vaultAta, adminAta, mint,
      vaultAuthority: vaultAuthorityPda, admin, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any).rpc();
    state.vestingAccounts[s.name] = { pda: pda.toBase58(), beneficiary: b.publicKey.toBase58(), amount: s.amount, cliffYears: 1, linearYears: 1 };
    console.log(`${s.name}: ${s.amount.toLocaleString()} GNDK  pda=${pda.toBase58()}  tx=${sig}`);
    await new Promise(r => setTimeout(r, 2000));
  }
  const out = path.join(__dirname, "rehearsal-devnet-state.json");
  fs.writeFileSync(out, JSON.stringify(state, null, 2));
  console.log("state →", out);
}
main().catch(e => { console.error(e); process.exit(1); });
