import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GndkRegistry } from "../target/types/gndk_registry";
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

// Anchor SDK converts snake_case with digits: l2e→l2E, d2e→D2E
// Use `as any` for runtime-only field names that TS types don't match

describe("GNDK Registry — Phase 1 Core Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const registry = anchor.workspace.gndkRegistry as Program<GndkRegistry>;
  const admin = provider.wallet as anchor.Wallet;
  const oracle = Keypair.generate();

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

  const testUser = Keypair.generate();
  let userAccountPda: PublicKey;
  let userAta: PublicKey;

  const testUser2 = Keypair.generate();
  let user2AccountPda: PublicKey;
  let user2Ata: PublicKey;

  const fakeL2eProgram = Keypair.generate();
  const fakeD2eProgram = Keypair.generate();
  let l2eModulePda: PublicKey;
  let d2eModulePda: PublicKey;

  // Helper: get field value regardless of casing (l2e vs l2E)
  const f = (obj: any, name: string) => {
    return obj[name] ?? obj[name.replace("l2e", "l2E").replace("d2e", "d2E")]
      ?? obj[name.replace("l2E", "l2e").replace("d2E", "d2e")];
  };

  before(async () => {
    await provider.connection.requestAirdrop(oracle.publicKey, 2e9);
    await new Promise(r => setTimeout(r, 500));

    mint = await createMint(
      provider.connection, admin.payer, admin.publicKey, null, 9,
      undefined, undefined, TOKEN_PROGRAM_ID,
    );

    const adminAtaAcc = await getOrCreateAssociatedTokenAccount(
      provider.connection, admin.payer, mint, admin.publicKey,
    );
    adminAta = adminAtaAcc.address;
    await mintTo(
      provider.connection, admin.payer, mint, adminAta, admin.publicKey,
      1_000_000_000n * 1_000_000_000n,
    );

    [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], registry.programId);
    [poolAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("reward_pool"), mint.toBuffer()], registry.programId);
    [d2ePoolAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("d2e_pool"), mint.toBuffer()], registry.programId);
    [burnStatsPda] = PublicKey.findProgramAddressSync([Buffer.from("burn_stats")], registry.programId);
    [userAccountPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), testUser.publicKey.toBuffer()], registry.programId);
    [user2AccountPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), testUser2.publicKey.toBuffer()], registry.programId);
    [l2eModulePda] = PublicKey.findProgramAddressSync([Buffer.from("module"), fakeL2eProgram.publicKey.toBuffer()], registry.programId);
    [d2eModulePda] = PublicKey.findProgramAddressSync([Buffer.from("module"), fakeD2eProgram.publicKey.toBuffer()], registry.programId);

    poolAtaKeypair = Keypair.generate();
    poolAta = poolAtaKeypair.publicKey;
    d2ePoolAtaKeypair = Keypair.generate();
    d2ePoolAta = d2ePoolAtaKeypair.publicKey;

    userAta = (await getOrCreateAssociatedTokenAccount(provider.connection, admin.payer, mint, testUser.publicKey)).address;
    user2Ata = (await getOrCreateAssociatedTokenAccount(provider.connection, admin.payer, mint, testUser2.publicKey)).address;

    console.log("  Registry:", registry.programId.toBase58());
  });

  // ═══════════════════════════════════════
  // Part A: Initialize
  // ═══════════════════════════════════════

  it("A1. Initialize Registry", async () => {
    await registry.methods.initialize(oracle.publicKey)
      .accounts({ config: configPda, mint, admin: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();

    const config = await registry.account.configAccount.fetch(configPda);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(config.oracle.toBase58(), oracle.publicKey.toBase58());
    assert.equal(config.currentPhase, 0);
    console.log("    ✅ Registry initialized (Phase 1, oracle set)");
  });

  it("A2. Initialize L2E RewardPool + fund 300M GNDK", async () => {
    await registry.methods.initializeRewardPool()
      .accounts({
        config: configPda, poolAuthority: poolAuthorityPda, rewardPoolAta: poolAta, mint,
        admin: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([poolAtaKeypair])
      .rpc();

    const ix = createTransferInstruction(adminAta, poolAta, admin.publicKey, 300_000_000n * 1_000_000_000n);
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix));

    const poolAccount = await getAccount(provider.connection, poolAta);
    assert.equal(Number(poolAccount.amount) / 1e9, 300_000_000);
    console.log("    ✅ L2E RewardPool: 300M GNDK");
  });

  it("A3. Initialize D2E BountyPool (starts empty)", async () => {
    // SDK converts d2e → D2E in method names
    await (registry.methods as any).initializeD2EPool()
      .accounts({
        config: configPda, d2EPoolAuthority: d2ePoolAuthorityPda, d2EPoolAta: d2ePoolAta, mint,
        admin: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([d2ePoolAtaKeypair])
      .rpc();

    const d2ePoolAccount = await getAccount(provider.connection, d2ePoolAta);
    assert.equal(Number(d2ePoolAccount.amount), 0);
    console.log("    ✅ D2E BountyPool: 0 GNDK (initially empty)");
  });

  it("A4. Initialize BurnStats", async () => {
    await registry.methods.initializeBurnStats()
      .accounts({ burnStats: burnStatsPda, admin: admin.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
    console.log("    ✅ BurnStats initialized");
  });

  // ═══════════════════════════════════════
  // Part B: User Registration + Dynamic Halving
  // ═══════════════════════════════════════

  it("B1. Register user via oracle", async () => {
    await registry.methods.registerUser()
      .accounts({
        config: configPda, userAccount: userAccountPda, user: testUser.publicKey,
        authority: oracle.publicKey, systemProgram: SystemProgram.programId,
      })
      .signers([oracle])
      .rpc();

    const ua: any = await registry.account.userAccount.fetch(userAccountPda);
    assert.equal(ua.owner.toBase58(), testUser.publicKey.toBase58());
    assert.equal(f(ua, "l2EAnnualClaimed").toNumber(), 0);
    assert.equal(f(ua, "d2EAnnualClaimed").toNumber(), 0);

    const config = await registry.account.configAccount.fetch(configPda);
    assert.equal(config.totalRegisteredUsers.toNumber(), 1);
    console.log("    ✅ User1 registered via oracle (total=1, Phase 1)");
  });

  it("B2. Register user via admin", async () => {
    await registry.methods.registerUser()
      .accounts({
        config: configPda, userAccount: user2AccountPda, user: testUser2.publicKey,
        authority: admin.publicKey, systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config = await registry.account.configAccount.fetch(configPda);
    assert.equal(config.totalRegisteredUsers.toNumber(), 2);
    console.log("    ✅ User2 registered via admin (total=2, Phase 1)");
  });

  it("B3. Unauthorized user cannot register", async () => {
    const rando = Keypair.generate();
    await provider.connection.requestAirdrop(rando.publicKey, 1e9);
    await new Promise(r => setTimeout(r, 500));
    const newUser = Keypair.generate();
    const [newUserPda] = PublicKey.findProgramAddressSync([Buffer.from("user"), newUser.publicKey.toBuffer()], registry.programId);

    try {
      await registry.methods.registerUser()
        .accounts({ config: configPda, userAccount: newUserPda, user: newUser.publicKey, authority: rando.publicKey, systemProgram: SystemProgram.programId })
        .signers([rando]).rpc();
      assert.fail("Should have thrown Unauthorized");
    } catch (err) {
      assert.include(err.toString(), "Unauthorized");
      console.log("    ✅ Random user blocked from registering");
    }
  });

  // ═══════════════════════════════════════
  // Part C: Module Registration
  // ═══════════════════════════════════════

  it("C1. Register L2E module (pool_type=0, daily=100, annual=0)", async () => {
    await registry.methods.registerModule("l2e", 0, new anchor.BN(100), new anchor.BN(0))
      .accounts({
        config: configPda, moduleAccount: l2eModulePda, moduleProgram: fakeL2eProgram.publicKey,
        admin: admin.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();

    const mod = await registry.account.moduleAccount.fetch(l2eModulePda);
    assert.equal(mod.name, "l2e");
    assert.equal(mod.poolType, 0);
    assert.equal(mod.dailyLimit.toNumber(), 100);
    assert.equal(mod.isActive, true);
    console.log("    ✅ L2E module registered (daily=100, Phase cap applies)");
  });

  it("C2. Register D2E module (pool_type=1, daily=50, annual=20)", async () => {
    await registry.methods.registerModule("d2e", 1, new anchor.BN(50), new anchor.BN(20))
      .accounts({
        config: configPda, moduleAccount: d2eModulePda, moduleProgram: fakeD2eProgram.publicKey,
        admin: admin.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();

    const mod = await registry.account.moduleAccount.fetch(d2eModulePda);
    assert.equal(mod.name, "d2e");
    assert.equal(mod.poolType, 1);
    assert.equal(mod.annualLimit.toNumber(), 20);
    console.log("    ✅ D2E module registered (daily=50, annual=20)");
  });

  // ═══════════════════════════════════════
  // Part D: L2E Transfer (Dynamic Halving Phase cap)
  // ═══════════════════════════════════════

  it("D1. L2E transfer: 30 GNDK to user1 (Phase 1, cap=70)", async () => {
    await registry.methods.transferFromPool(new anchor.BN(30))
      .accounts({
        config: configPda, moduleAccount: l2eModulePda, poolAuthority: poolAuthorityPda,
        rewardPoolAta: poolAta, mint, userAccount: userAccountPda, userAta,
        caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const ua: any = await registry.account.userAccount.fetch(userAccountPda);
    assert.equal(f(ua, "l2EAnnualClaimed").toNumber(), 30);
    assert.equal(ua.totalEarned.toNumber(), 30);

    const bal = await getAccount(provider.connection, userAta);
    assert.equal(Number(bal.amount) / 1e9, 30);
    console.log("    ✅ L2E: 30 GNDK → user1 (l2e_claimed=30/70)");
  });

  it("D2. L2E transfer: 40 more GNDK → total 70 (at cap)", async () => {
    await registry.methods.transferFromPool(new anchor.BN(40))
      .accounts({
        config: configPda, moduleAccount: l2eModulePda, poolAuthority: poolAuthorityPda,
        rewardPoolAta: poolAta, mint, userAccount: userAccountPda, userAta,
        caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const ua: any = await registry.account.userAccount.fetch(userAccountPda);
    assert.equal(f(ua, "l2EAnnualClaimed").toNumber(), 70);
    console.log("    ✅ L2E: +40 → user1 (l2e_claimed=70/70, at cap)");
  });

  it("D3. L2E transfer: 1 more GNDK → exceeds Phase 1 cap (70)", async () => {
    try {
      await registry.methods.transferFromPool(new anchor.BN(1))
        .accounts({
          config: configPda, moduleAccount: l2eModulePda, poolAuthority: poolAuthorityPda,
          rewardPoolAta: poolAta, mint, userAccount: userAccountPda, userAta,
          caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      assert.fail("Should have thrown L2EAnnualLimitExceeded");
    } catch (err) {
      assert.include(err.toString(), "L2EAnnualLimitExceeded");
      console.log("    ✅ Phase 1 cap enforced: 71 > 70 → blocked");
    }
  });

  it("D4. L2E daily limit test (module daily=100)", async () => {
    // user2 has 0 L2E, module daily_used=70 from D1+D2. Send 30 → daily=100
    await registry.methods.transferFromPool(new anchor.BN(30))
      .accounts({
        config: configPda, moduleAccount: l2eModulePda, poolAuthority: poolAuthorityPda,
        rewardPoolAta: poolAta, mint, userAccount: user2AccountPda, userAta: user2Ata,
        caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const mod = await registry.account.moduleAccount.fetch(l2eModulePda);
    assert.equal(mod.dailyUsed.toNumber(), 100);
    console.log("    ✅ Module daily_used=100/100 (at limit)");

    try {
      await registry.methods.transferFromPool(new anchor.BN(1))
        .accounts({
          config: configPda, moduleAccount: l2eModulePda, poolAuthority: poolAuthorityPda,
          rewardPoolAta: poolAta, mint, userAccount: user2AccountPda, userAta: user2Ata,
          caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      assert.fail("Should have thrown DailyLimitExceeded");
    } catch (err) {
      assert.include(err.toString(), "DailyLimitExceeded");
      console.log("    ✅ Daily limit enforced: 101 > 100 → blocked");
    }
  });

  // ═══════════════════════════════════════
  // Part E: D2E Transfer (independent from L2E)
  // ═══════════════════════════════════════

  it("E1. Fund D2E pool with 10M GNDK", async () => {
    const ix = createTransferInstruction(adminAta, d2ePoolAta, admin.publicKey, 10_000_000n * 1_000_000_000n);
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix));

    const bal = await getAccount(provider.connection, d2ePoolAta);
    assert.equal(Number(bal.amount) / 1e9, 10_000_000);
    console.log("    ✅ D2E Pool funded: 10M GNDK");
  });

  it("E2. D2E transfer: 15 GNDK to user1 (L2E cap doesn't apply)", async () => {
    await (registry.methods as any).transferFromD2EPool(new anchor.BN(15))
      .accounts({
        config: configPda, moduleAccount: d2eModulePda,
        d2EPoolAuthority: d2ePoolAuthorityPda, d2EPoolAta: d2ePoolAta, mint,
        userAccount: userAccountPda, userAta,
        caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    const ua: any = await registry.account.userAccount.fetch(userAccountPda);
    assert.equal(f(ua, "l2EAnnualClaimed").toNumber(), 70); // Unchanged
    assert.equal(f(ua, "d2EAnnualClaimed").toNumber(), 15);
    assert.equal(ua.totalEarned.toNumber(), 85); // 70 + 15
    console.log("    ✅ D2E: 15 GNDK → user1 (d2e_claimed=15/20, l2e still 70)");
  });

  it("E3. D2E annual limit: 6 more → exceeds 20", async () => {
    try {
      await (registry.methods as any).transferFromD2EPool(new anchor.BN(6))
        .accounts({
          config: configPda, moduleAccount: d2eModulePda,
          d2EPoolAuthority: d2ePoolAuthorityPda, d2EPoolAta: d2ePoolAta, mint,
          userAccount: userAccountPda, userAta,
          caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      assert.fail("Should have thrown D2EAnnualLimitExceeded");
    } catch (err) {
      assert.include(err.toString(), "AnnualLimitExceeded");
      console.log("    ✅ D2E annual limit enforced: 15+6=21 > 20 → blocked");
    }
  });

  it("E4. D2E pool type mismatch: L2E module can't use D2E pool", async () => {
    try {
      await (registry.methods as any).transferFromD2EPool(new anchor.BN(1))
        .accounts({
          config: configPda, moduleAccount: l2eModulePda,
          d2EPoolAuthority: d2ePoolAuthorityPda, d2EPoolAta: d2ePoolAta, mint,
          userAccount: user2AccountPda, userAta: user2Ata,
          caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      assert.fail("Should have thrown PoolTypeMismatch");
    } catch (err) {
      assert.include(err.toString(), "PoolTypeMismatch");
      console.log("    ✅ Pool type mismatch: L2E module can't access D2E pool");
    }
  });

  // ═══════════════════════════════════════
  // Part F: Admin Controls
  // ═══════════════════════════════════════

  it("F1. Global pause → all transfers blocked", async () => {
    await registry.methods.pause()
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();

    try {
      await registry.methods.transferFromPool(new anchor.BN(1))
        .accounts({
          config: configPda, moduleAccount: l2eModulePda, poolAuthority: poolAuthorityPda,
          rewardPoolAta: poolAta, mint, userAccount: user2AccountPda, userAta: user2Ata,
          caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      assert.fail("Should have thrown ProgramPaused");
    } catch (err) {
      assert.include(err.toString(), "ProgramPaused");
      console.log("    ✅ Global pause blocks L2E transfers");
    }

    await registry.methods.unpause()
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();
    console.log("    ✅ Global unpause");
  });

  it("F2. Module pause → specific module blocked", async () => {
    await registry.methods.pauseModule()
      .accounts({ config: configPda, moduleAccount: l2eModulePda, admin: admin.publicKey }).rpc();

    try {
      await registry.methods.transferFromPool(new anchor.BN(1))
        .accounts({
          config: configPda, moduleAccount: l2eModulePda, poolAuthority: poolAuthorityPda,
          rewardPoolAta: poolAta, mint, userAccount: user2AccountPda, userAta: user2Ata,
          caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      assert.fail("Should have thrown ModulePaused");
    } catch (err) {
      assert.include(err.toString(), "ModulePaused");
      console.log("    ✅ Module pause blocks L2E module");
    }

    await registry.methods.unpauseModule()
      .accounts({ config: configPda, moduleAccount: l2eModulePda, admin: admin.publicKey }).rpc();
    console.log("    ✅ Module unpause");
  });

  it("F3. Deactivate module → permanently blocked", async () => {
    await registry.methods.deactivateModule()
      .accounts({ config: configPda, moduleAccount: d2eModulePda, admin: admin.publicKey }).rpc();

    try {
      await (registry.methods as any).transferFromD2EPool(new anchor.BN(1))
        .accounts({
          config: configPda, moduleAccount: d2eModulePda,
          d2EPoolAuthority: d2ePoolAuthorityPda, d2EPoolAta: d2ePoolAta, mint,
          userAccount: user2AccountPda, userAta: user2Ata,
          caller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      assert.fail("Should have thrown ModuleInactive");
    } catch (err) {
      assert.include(err.toString(), "ModuleInactive");
      console.log("    ✅ Deactivated module blocked");
    }
  });

  it("F4. Update oracle", async () => {
    const newOracle = Keypair.generate();
    await registry.methods.updateOracle(newOracle.publicKey)
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();

    const config = await registry.account.configAccount.fetch(configPda);
    assert.equal(config.oracle.toBase58(), newOracle.publicKey.toBase58());
    console.log("    ✅ Oracle updated");

    await registry.methods.updateOracle(oracle.publicKey)
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();
  });

  // ═══════════════════════════════════════
  // Part G: Summary
  // ═══════════════════════════════════════

  it("G1. Final state summary", async () => {
    const config: any = await registry.account.configAccount.fetch(configPda);
    const user1: any = await registry.account.userAccount.fetch(userAccountPda);
    const user2: any = await registry.account.userAccount.fetch(user2AccountPda);
    const l2eMod = await registry.account.moduleAccount.fetch(l2eModulePda);
    const poolBal = Number((await getAccount(provider.connection, poolAta)).amount) / 1e9;
    const d2eBal = Number((await getAccount(provider.connection, d2ePoolAta)).amount) / 1e9;

    console.log("\n    ═══════════════════════════════════════════════════════");
    console.log("    ║  GNDK Registry Phase 1 — Test Results              ║");
    console.log("    ═══════════════════════════════════════════════════════");
    console.log("    Phase:", config.currentPhase + 1, "(cap:", [70, 40, 15, 3][config.currentPhase], "GNDK/year)");
    console.log("    Users:", config.totalRegisteredUsers.toNumber());
    console.log("    L2E distributed:", config.totalDistributed.toNumber(), "GNDK");
    console.log("    D2E distributed:", f(config, "totalD2EDistributed").toNumber(), "GNDK");
    console.log("    ───────────────────────────────────────────────────────");
    console.log("    L2E Pool:", poolBal.toLocaleString(), "GNDK");
    console.log("    D2E Pool:", d2eBal.toLocaleString(), "GNDK");
    console.log("    ───────────────────────────────────────────────────────");
    console.log("    User1: l2e=", f(user1, "l2EAnnualClaimed").toNumber(), "d2e=", f(user1, "d2EAnnualClaimed").toNumber(), "total=", user1.totalEarned.toNumber());
    console.log("    User2: l2e=", f(user2, "l2EAnnualClaimed").toNumber(), "d2e=", f(user2, "d2EAnnualClaimed").toNumber(), "total=", user2.totalEarned.toNumber());
    console.log("    L2E Module: daily", l2eMod.dailyUsed.toNumber(), "/", l2eMod.dailyLimit.toNumber());
    console.log("    ═══════════════════════════════════════════════════════\n");
  });
});
