import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GndkRegistry } from "../target/types/gndk_registry";
import { L2eModule } from "../target/types/l2e_module";
import { BurnRecycle } from "../target/types/burn_recycle";
import { VestingProgram } from "../target/types/vesting_program";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  mintTo,
  createMint,
  createTransferInstruction,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

// Anchor SDK casing helper (l2e→l2E, d2e→D2E)
const f = (obj: any, name: string) => {
  return obj[name] ?? obj[name.replace("l2e", "l2E").replace("d2e", "d2E")]
    ?? obj[name.replace("l2E", "l2e").replace("d2E", "d2e")];
};

describe("GNDK Phase 2-4 — L2E Module, BurnRecycle, Vesting", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registry = anchor.workspace.gndkRegistry as Program<GndkRegistry>;
  const l2e = anchor.workspace.l2eModule as Program<L2eModule>;
  const burnRecycle = anchor.workspace.burnRecycle as Program<BurnRecycle>;
  const vesting = anchor.workspace.vestingProgram as Program<VestingProgram>;

  const admin = provider.wallet as anchor.Wallet;
  const oracle = Keypair.generate();

  // These will be populated from Phase 1's existing state
  let mint: PublicKey;
  let adminAta: PublicKey;
  let configPda: PublicKey;
  let poolAuthorityPda: PublicKey;
  let burnStatsPda: PublicKey;
  let poolAta: PublicKey;

  // L2E Module
  let l2eConfigPda: PublicKey;
  let l2eModulePda: PublicKey;

  // BurnRecycle
  let burnConfigPda: PublicKey;

  // Vesting (uses its own mint to avoid pool conflicts)
  let vestingMint: PublicKey;
  let vestingAdminAta: PublicKey;
  let vestingConfigPda: PublicKey;
  let vaultAuthorityPda: PublicKey;
  let vaultAta: PublicKey;
  let vaultAtaKeypair: Keypair;

  // Test users
  const testUser = Keypair.generate();
  let userAccountPda: PublicKey;
  let userAta: PublicKey;

  const beneficiary = Keypair.generate();
  let beneficiaryAta: PublicKey;
  let vestingAccountPda: PublicKey;

  before(async () => {
    // Airdrop
    await provider.connection.requestAirdrop(oracle.publicKey, 5e9);
    await provider.connection.requestAirdrop(testUser.publicKey, 2e9);
    await provider.connection.requestAirdrop(beneficiary.publicKey, 2e9);
    await new Promise(r => setTimeout(r, 500));

    // ═══ Reuse Phase 1's Registry state ═══
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")], registry.programId);

    // Fetch existing config to get mint
    const existingConfig = await registry.account.configAccount.fetch(configPda);
    mint = existingConfig.mint;

    // Derive pool authority PDA
    [poolAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("reward_pool"), mint.toBuffer()], registry.programId);
    [burnStatsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("burn_stats")], registry.programId);

    // Find the pool ATA (token account owned by pool authority)
    const tokenAccounts = await provider.connection.getTokenAccountsByOwner(
      poolAuthorityPda, { mint }
    );
    poolAta = tokenAccounts.value[0].pubkey;

    // Admin ATA
    adminAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, admin.payer, mint, admin.publicKey,
    )).address;

    // Update oracle in registry to our new oracle
    await registry.methods.updateOracle(oracle.publicKey)
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();

    // Register new test user
    [userAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), testUser.publicKey.toBuffer()], registry.programId);
    userAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, admin.payer, mint, testUser.publicKey,
    )).address;

    // Register user (might fail if already exists from Phase 1 with same key — use fresh key)
    await registry.methods.registerUser()
      .accounts({
        config: configPda, userAccount: userAccountPda, user: testUser.publicKey,
        authority: oracle.publicKey, systemProgram: SystemProgram.programId,
      })
      .signers([oracle])
      .rpc();

    // ═══ L2E Module PDAs ═══
    [l2eConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("l2e_config")], l2e.programId);
    [l2eModulePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("module"), l2e.programId.toBuffer()], registry.programId);

    // ═══ BurnRecycle PDAs ═══
    [burnConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("burn_recycle_config")], burnRecycle.programId);

    // ═══ Vesting: uses its own separate mint ═══
    vestingMint = await createMint(
      provider.connection, admin.payer, admin.publicKey, null, 9,
      undefined, undefined, TOKEN_PROGRAM_ID,
    );
    vestingAdminAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, admin.payer, vestingMint, admin.publicKey,
    )).address;
    await mintTo(
      provider.connection, admin.payer, vestingMint, vestingAdminAta, admin.publicKey,
      500_000_000n * 1_000_000_000n,
    );
    beneficiaryAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, admin.payer, vestingMint, beneficiary.publicKey,
    )).address;

    [vestingConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_config")], vesting.programId);
    [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_vault"), vestingMint.toBuffer()], vesting.programId);
    [vestingAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting"), beneficiary.publicKey.toBuffer()], vesting.programId);

    vaultAtaKeypair = Keypair.generate();
    vaultAta = vaultAtaKeypair.publicKey;

    console.log("  Registry:", registry.programId.toBase58());
    console.log("  L2E:     ", l2e.programId.toBase58());
    console.log("  Burn:    ", burnRecycle.programId.toBase58());
    console.log("  Vesting: ", vesting.programId.toBase58());
    console.log("  Mint (Registry):", mint.toBase58());
    console.log("  Mint (Vesting): ", vestingMint.toBase58());
  });

  // ═══════════════════════════════════════
  // Phase 2: L2E Module (CPI → Registry)
  // ═══════════════════════════════════════

  it("H1. Initialize L2E Module", async () => {
    await l2e.methods.initialize()
      .accounts({
        l2eConfig: l2eConfigPda, oracle: oracle.publicKey,
        mint: mint,
        admin: admin.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();

    const config = await l2e.account.l2EConfig.fetch(l2eConfigPda);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(config.oracle.toBase58(), oracle.publicKey.toBase58());
    assert.equal(config.mint.toBase58(), mint.toBase58());
    assert.equal(config.isActive, true);
    console.log("    ✅ L2E Module initialized — mint bound: " + mint.toBase58());
  });

  it("H2. Register L2E Module in Registry", async () => {
    await registry.methods.registerModule("l2e-cpi", 0, new anchor.BN(1000), new anchor.BN(0))
      .accounts({
        config: configPda, moduleAccount: l2eModulePda,
        moduleProgram: l2e.programId,
        admin: admin.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();

    const mod = await registry.account.moduleAccount.fetch(l2eModulePda);
    assert.equal(mod.name, "l2e-cpi");
    assert.equal(mod.poolType, 0);
    console.log("    ✅ L2E Module registered in Registry");
  });

  it("H3. L2E distribute via CPI → Registry.transfer_from_pool", async () => {
    const balBefore = Number((await getAccount(provider.connection, userAta)).amount) / 1e9;

    await l2e.methods.distribute(new anchor.BN(25))
      .accounts({
        l2eConfig: l2eConfigPda,
        registryProgram: registry.programId,
        registryConfig: configPda,
        moduleAccount: l2eModulePda,
        poolAuthority: poolAuthorityPda,
        rewardPoolAta: poolAta,
        mint,
        userAccount: userAccountPda,
        userAta,
        caller: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const balAfter = Number((await getAccount(provider.connection, userAta)).amount) / 1e9;
    assert.equal(balAfter - balBefore, 25);

    const ua: any = await registry.account.userAccount.fetch(userAccountPda);
    assert.equal(f(ua, "l2EAnnualClaimed").toNumber(), 25);

    const l2eConfig = await l2e.account.l2EConfig.fetch(l2eConfigPda);
    assert.equal(l2eConfig.totalDistributed.toNumber(), 25);

    console.log("    ✅ L2E CPI: 25 GNDK → user (l2e_claimed=25)");
  });

  it("H4. L2E Phase cap enforced via CPI", async () => {
    // Phase 1 cap = 70. Already claimed 25. Send 45 → total 70 OK
    await l2e.methods.distribute(new anchor.BN(45))
      .accounts({
        l2eConfig: l2eConfigPda,
        registryProgram: registry.programId,
        registryConfig: configPda,
        moduleAccount: l2eModulePda,
        poolAuthority: poolAuthorityPda,
        rewardPoolAta: poolAta,
        mint,
        userAccount: userAccountPda,
        userAta,
        caller: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const ua: any = await registry.account.userAccount.fetch(userAccountPda);
    assert.equal(f(ua, "l2EAnnualClaimed").toNumber(), 70);
    console.log("    ✅ L2E CPI: +45 → l2e_claimed=70/70 (at cap)");

    // 1 more → exceeds cap
    try {
      await l2e.methods.distribute(new anchor.BN(1))
        .accounts({
          l2eConfig: l2eConfigPda,
          registryProgram: registry.programId,
          registryConfig: configPda,
          moduleAccount: l2eModulePda,
          poolAuthority: poolAuthorityPda,
          rewardPoolAta: poolAta,
          mint,
          userAccount: userAccountPda,
          userAta,
          caller: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.toString(), "AnnualLimitExceeded");
      console.log("    ✅ Phase cap via CPI: 71 > 70 → blocked");
    }
  });

  it("H5. L2E unauthorized caller blocked", async () => {
    const rando = Keypair.generate();
    await provider.connection.requestAirdrop(rando.publicKey, 1e9);
    await new Promise(r => setTimeout(r, 500));

    try {
      await l2e.methods.distribute(new anchor.BN(1))
        .accounts({
          l2eConfig: l2eConfigPda,
          registryProgram: registry.programId,
          registryConfig: configPda,
          moduleAccount: l2eModulePda,
          poolAuthority: poolAuthorityPda,
          rewardPoolAta: poolAta,
          mint,
          userAccount: userAccountPda,
          userAta,
          caller: rando.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([rando])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.toString(), "Unauthorized");
      console.log("    ✅ Random caller blocked from L2E distribute");
    }
  });

  it("H6. L2E pause/unpause", async () => {
    await l2e.methods.pause()
      .accounts({ l2eConfig: l2eConfigPda, admin: admin.publicKey }).rpc();
    let config = await l2e.account.l2EConfig.fetch(l2eConfigPda);
    assert.equal(config.isActive, false);

    await l2e.methods.unpause()
      .accounts({ l2eConfig: l2eConfigPda, admin: admin.publicKey }).rpc();
    config = await l2e.account.l2EConfig.fetch(l2eConfigPda);
    assert.equal(config.isActive, true);
    console.log("    ✅ L2E pause/unpause works");
  });

  // ═══════════════════════════════════════
  // Phase 3: BurnRecycle
  // ═══════════════════════════════════════

  it("I1. Initialize BurnRecycle", async () => {
    await burnRecycle.methods.initialize(poolAta)
      .accounts({
        config: burnConfigPda, mint, admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      }).rpc();

    const config = await burnRecycle.account.burnRecycleConfig.fetch(burnConfigPda);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(config.mint.toBase58(), mint.toBase58());
    assert.equal(config.isActive, true);
    console.log("    ✅ BurnRecycle initialized");
  });

  it("I2. process_payment: 50 GNDK → 25 burn + 25 recycle", async () => {
    // User has 70 GNDK from L2E. Use 50 for payment.
    const poolBefore = Number((await getAccount(provider.connection, poolAta)).amount) / 1e9;
    const userBefore = Number((await getAccount(provider.connection, userAta)).amount) / 1e9;

    await burnRecycle.methods.processPayment(new anchor.BN(50))
      .accounts({
        config: burnConfigPda, mint, payerAta: userAta,
        rewardPoolAta: poolAta, payer: testUser.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([testUser])
      .rpc();

    const poolAfter = Number((await getAccount(provider.connection, poolAta)).amount) / 1e9;
    const userAfter = Number((await getAccount(provider.connection, userAta)).amount) / 1e9;

    assert.equal(userBefore - userAfter, 50);
    assert.equal(poolAfter - poolBefore, 25); // 50% recycled

    const config = await burnRecycle.account.burnRecycleConfig.fetch(burnConfigPda);
    assert.equal(config.totalBurned.toNumber() / 1e9, 25);
    assert.equal(config.totalRecycled.toNumber() / 1e9, 25);

    console.log("    ✅ process_payment: 50 GNDK → 25 burned + 25 recycled");
  });

  it("I3. admin_burn: 100 GNDK → 100% burn", async () => {
    const adminBalBefore = Number((await getAccount(provider.connection, adminAta)).amount);

    await burnRecycle.methods.adminBurn(new anchor.BN(100))
      .accounts({
        config: burnConfigPda, mint, adminAta,
        admin: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const adminBalAfter = Number((await getAccount(provider.connection, adminAta)).amount);
    assert.equal((adminBalBefore - adminBalAfter) / 1e9, 100);

    const config = await burnRecycle.account.burnRecycleConfig.fetch(burnConfigPda);
    assert.equal(config.totalAdminBurned.toNumber() / 1e9, 100);
    // total_burned = 25 (payment) + 100 (admin) = 125
    assert.equal(config.totalBurned.toNumber() / 1e9, 125);

    console.log("    ✅ admin_burn: 100 GNDK permanently burned");
  });

  it("I4. BurnRecycle pause blocks payments", async () => {
    await burnRecycle.methods.pause()
      .accounts({ config: burnConfigPda, admin: admin.publicKey }).rpc();

    try {
      await burnRecycle.methods.processPayment(new anchor.BN(1))
        .accounts({
          config: burnConfigPda, mint, payerAta: userAta,
          rewardPoolAta: poolAta, payer: testUser.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([testUser])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.toString(), "paused");
      console.log("    ✅ BurnRecycle pause blocks payments");
    }

    await burnRecycle.methods.unpause()
      .accounts({ config: burnConfigPda, admin: admin.publicKey }).rpc();
    console.log("    ✅ BurnRecycle unpaused");
  });

  // ═══════════════════════════════════════
  // Phase 4: Vesting (separate mint)
  // ═══════════════════════════════════════

  it("J1. Initialize Vesting Program", async () => {
    await vesting.methods.initialize()
      .accounts({
        config: vestingConfigPda, mint: vestingMint,
        admin: admin.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();

    const config = await vesting.account.vestingConfig.fetch(vestingConfigPda);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(config.mint.toBase58(), vestingMint.toBase58());
    console.log("    ✅ Vesting initialized");
  });

  it("J2. Initialize Vesting Vault", async () => {
    await vesting.methods.initializeVault()
      .accounts({
        config: vestingConfigPda, vaultAuthority: vaultAuthorityPda,
        vaultAta, mint: vestingMint, admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([vaultAtaKeypair])
      .rpc();
    console.log("    ✅ Vesting vault initialized");
  });

  it("J3. Create vesting: 1000 GNDK, cliff=2s, linear=4s", async () => {
    await vesting.methods.createVesting(
      new anchor.BN(1000),
      new anchor.BN(2),  // cliff 2s
      new anchor.BN(4),  // linear 4s
    ).accounts({
      config: vestingConfigPda, vestingAccount: vestingAccountPda,
      beneficiary: beneficiary.publicKey, vaultAta,
      adminAta: vestingAdminAta, mint: vestingMint,
      vaultAuthority: vaultAuthorityPda,
      admin: admin.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).rpc();

    const va = await vesting.account.vestingAccount.fetch(vestingAccountPda);
    assert.equal(va.totalAmount.toNumber(), 1000);
    assert.equal(va.claimedAmount.toNumber(), 0);
    assert.equal(va.revoked, false);

    const vaultBal = Number((await getAccount(provider.connection, vaultAta)).amount) / 1e9;
    assert.equal(vaultBal, 1000);

    console.log("    ✅ Vesting: 1000 GNDK, cliff=2s, linear=4s");
  });

  it("J4. Claim before cliff → nothing to claim", async () => {
    try {
      await vesting.methods.claim()
        .accounts({
          config: vestingConfigPda, vestingAccount: vestingAccountPda,
          vaultAuthority: vaultAuthorityPda, vaultAta, mint: vestingMint,
          beneficiaryAta, beneficiary: beneficiary.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary])
        .rpc();
      assert.fail("Should have thrown NothingToClaim");
    } catch (err) {
      assert.include(err.toString(), "NothingToClaim");
      console.log("    ✅ Claim before cliff: blocked");
    }
  });

  it("J5. Wait for cliff + partial vest, then claim", async () => {
    console.log("    ⏳ Waiting 4s (cliff=2s + 2s linear)...");
    await new Promise(r => setTimeout(r, 4000));

    await vesting.methods.claim()
      .accounts({
        config: vestingConfigPda, vestingAccount: vestingAccountPda,
        vaultAuthority: vaultAuthorityPda, vaultAta, mint: vestingMint,
        beneficiaryAta, beneficiary: beneficiary.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    const va = await vesting.account.vestingAccount.fetch(vestingAccountPda);
    const claimed = va.claimedAmount.toNumber();
    assert.isAbove(claimed, 100, "Should have claimed some tokens");
    assert.isBelow(claimed, 900, "Should not have claimed everything");

    const bal = Number((await getAccount(provider.connection, beneficiaryAta)).amount) / 1e9;
    assert.equal(bal, claimed);

    console.log(`    ✅ Partial claim: ${claimed} GNDK (~${Math.round(claimed/10)}%)`);
  });

  it("J6. Wait for full vest, claim remainder", async () => {
    console.log("    ⏳ Waiting 4s for full vesting...");
    await new Promise(r => setTimeout(r, 4000));

    await vesting.methods.claim()
      .accounts({
        config: vestingConfigPda, vestingAccount: vestingAccountPda,
        vaultAuthority: vaultAuthorityPda, vaultAta, mint: vestingMint,
        beneficiaryAta, beneficiary: beneficiary.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    const va = await vesting.account.vestingAccount.fetch(vestingAccountPda);
    assert.equal(va.claimedAmount.toNumber(), 1000);

    const bal = Number((await getAccount(provider.connection, beneficiaryAta)).amount) / 1e9;
    assert.equal(bal, 1000);

    console.log("    ✅ Full claim: 1000 GNDK");
  });

  it("J7. Revoke test: create + immediate revoke", async () => {
    const revokeBeneficiary = Keypair.generate();
    await provider.connection.requestAirdrop(revokeBeneficiary.publicKey, 1e9);
    await new Promise(r => setTimeout(r, 500));

    const revokeAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, admin.payer, vestingMint, revokeBeneficiary.publicKey,
    )).address;

    const [revokeVestingPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting"), revokeBeneficiary.publicKey.toBuffer()],
      vesting.programId,
    );

    // Create: 500 GNDK, long cliff (100s)
    await vesting.methods.createVesting(
      new anchor.BN(500),
      new anchor.BN(100),
      new anchor.BN(100),
    ).accounts({
      config: vestingConfigPda, vestingAccount: revokeVestingPda,
      beneficiary: revokeBeneficiary.publicKey, vaultAta,
      adminAta: vestingAdminAta, mint: vestingMint,
      vaultAuthority: vaultAuthorityPda,
      admin: admin.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).rpc();

    const adminBalBefore = Number((await getAccount(provider.connection, vestingAdminAta)).amount);

    // Immediate revoke
    await vesting.methods.revoke()
      .accounts({
        config: vestingConfigPda, vestingAccount: revokeVestingPda,
        vaultAuthority: vaultAuthorityPda, vaultAta, mint: vestingMint,
        adminAta: vestingAdminAta, admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const va = await vesting.account.vestingAccount.fetch(revokeVestingPda);
    assert.equal(va.revoked, true);
    assert.equal(va.totalAmount.toNumber(), 0);

    const adminBalAfter = Number((await getAccount(provider.connection, vestingAdminAta)).amount);
    assert.equal((adminBalAfter - adminBalBefore) / 1e9, 500);

    const vc = await vesting.account.vestingConfig.fetch(vestingConfigPda);
    assert.equal(vc.totalRevoked.toNumber(), 500);

    console.log("    ✅ Revoke: 500 GNDK returned (0 vested before cliff)");
  });

  // ═══════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════

  it("K1. Phase 2-4 Summary", async () => {
    const regConfig: any = await registry.account.configAccount.fetch(configPda);
    const l2eConfig = await l2e.account.l2EConfig.fetch(l2eConfigPda);
    const burnConfig = await burnRecycle.account.burnRecycleConfig.fetch(burnConfigPda);
    const vestConfig = await vesting.account.vestingConfig.fetch(vestingConfigPda);
    const poolBal = Number((await getAccount(provider.connection, poolAta)).amount) / 1e9;

    console.log("\n    ═══════════════════════════════════════════════════════");
    console.log("    ║  GNDK Phase 2-4 — Test Results                    ║");
    console.log("    ═══════════════════════════════════════════════════════");
    console.log("    [Registry]");
    console.log("      Phase:", regConfig.currentPhase + 1);
    console.log("      L2E distributed:", regConfig.totalDistributed.toNumber(), "GNDK");
    console.log("      RewardPool:", poolBal.toLocaleString(), "GNDK");
    console.log("    [L2E Module — CPI]");
    console.log("      Total distributed:", l2eConfig.totalDistributed.toNumber(), "GNDK");
    console.log("      Active:", l2eConfig.isActive);
    console.log("    [BurnRecycle]");
    console.log("      Total burned:", (burnConfig.totalBurned.toNumber() / 1e9).toFixed(0), "GNDK");
    console.log("      Total recycled:", (burnConfig.totalRecycled.toNumber() / 1e9).toFixed(0), "GNDK");
    console.log("      Admin burned:", (burnConfig.totalAdminBurned.toNumber() / 1e9).toFixed(0), "GNDK");
    console.log("    [Vesting]");
    console.log("      Total created:", vestConfig.totalVestingCreated.toNumber(), "GNDK");
    console.log("      Total claimed:", vestConfig.totalClaimed.toNumber(), "GNDK");
    console.log("      Total revoked:", vestConfig.totalRevoked.toNumber(), "GNDK");
    console.log("    ═══════════════════════════════════════════════════════\n");
  });
});
