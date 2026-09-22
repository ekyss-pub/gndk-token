/**
 * GNDK Token — Register Token Metadata (Name, Symbol, Logo)
 *
 * Uploads logo to Arweave via Irys and creates on-chain metadata.
 *
 * Run:
 *   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
 *   npx ts-node --project tsconfig.json scripts/register-token-metadata.ts
 */

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import {
  createMetadataAccountV3,
  findMetadataPda,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  keypairIdentity,
  publicKey,
  createGenericFile,
} from "@metaplex-foundation/umi";
import * as fs from "fs";
import * as path from "path";

const MINT = "fksRmeMUXV3o3UzFtJ48BpoQoKkUhrYyXpCzXmsR3EF";
const LOGO_PATH = path.join(process.env.HOME!, "Documents/ganadara-logo-only.png");
const WALLET_PATH = path.join(process.env.HOME!, "dev/solana/deployer-mainnet.json");

async function main() {
  console.log("--- GNDK Token Metadata Registration ---\n");

  // Setup Umi
  const umi = createUmi("https://api.mainnet-beta.solana.com")
    .use(irysUploader());

  // Load wallet
  const walletFile = JSON.parse(fs.readFileSync(WALLET_PATH, "utf-8"));
  const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(walletFile));
  umi.use(keypairIdentity(keypair));

  console.log("Wallet:", keypair.publicKey);
  console.log("Mint:", MINT);

  // 1. Upload logo to Arweave
  console.log("\n1. Uploading logo to Arweave...");
  const logoBuffer = fs.readFileSync(LOGO_PATH);
  const logoFile = createGenericFile(logoBuffer, "ganadara-logo.png", {
    contentType: "image/png",
  });
  const [logoUri] = await umi.uploader.upload([logoFile]);
  console.log("  Logo URI:", logoUri);

  // 2. Upload metadata JSON
  console.log("\n2. Uploading metadata JSON...");
  const metadata = {
    name: "GANADA TOKEN",
    symbol: "GNDK",
    description: "Web3 Learn-to-Earn token for MYPOOL and GANADARA language learning ecosystems.",
    image: logoUri,
  };
  const metadataUri = await umi.uploader.uploadJson(metadata);
  console.log("  Metadata URI:", metadataUri);

  // 3. Create on-chain metadata
  console.log("\n3. Creating on-chain metadata...");
  const mintPubkey = publicKey(MINT);
  const metadataPda = findMetadataPda(umi, { mint: mintPubkey });

  await createMetadataAccountV3(umi, {
    metadata: metadataPda,
    mint: mintPubkey,
    mintAuthority: umi.identity,
    payer: umi.identity,
    updateAuthority: umi.identity.publicKey,
    data: {
      name: "GANADA TOKEN",
      symbol: "GNDK",
      uri: metadataUri,
      sellerFeeBasisPoints: 0,
      creators: null,
      collection: null,
      uses: null,
    },
    isMutable: true,
    collectionDetails: null,
  }).sendAndConfirm(umi);

  console.log("\n  Token metadata registered!");
  console.log("  Name: GANADA TOKEN");
  console.log("  Symbol: GNDK");
  console.log("  Logo:", logoUri);
  console.log("  Metadata:", metadataUri);
  console.log("\n  Check on Solscan:");
  console.log("  https://solscan.io/token/" + MINT);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
