import { PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  createTransferInstruction,
} from "@solana/spl-token";
import { assert } from "chai";

import {
  sendIxs,
  oneToken,
  findPDA,
  toBN,
  timeTravel,
  getTime,
  expectReverted,
  numToHex,
  processTransaction,
} from "../helpers";
import { setupStaking, StakingFixture } from "./fixture";

describe("02-staking", () => {
  let env: StakingFixture;

  const userState = (user: PublicKey): PublicKey =>
    findPDA(["user", user], env.program)[0];

  const stakePosition = (user: PublicKey, index: number): PublicKey =>
    findPDA(
      ["stake", user, toBN(index).toArrayLike(Buffer, "le", 8)],
      env.program,
    )[0];

  before(async () => {
    env = await setupStaking();
  });

  it("stakes one token into a new position", async () => {
    const { context, program, payer, rddkMint, userRddkAta } = env;
    const position = stakePosition(payer.publicKey, 0);

    const stakeIx = await program.methods
      .stake(oneToken())
      .accountsPartial({
        stakePosition: position,
        userRddkAta,
        rddkMint,
        user: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], stakeIx);

    const pos = await program.account.stakePosition.fetch(position);
    assert.equal(pos.amount.toString(), oneToken().toString());
    assert.isAbove(pos.stakedAt.toNumber(), 0);

    const user = await program.account.userState.fetch(
      userState(payer.publicKey),
    );
    assert.equal(user.stakeCount.toNumber(), 1);
  });

  it("stakes multiple times, tracking separate positions and updating stakeCount", async () => {
    const { context, program, payer, rddkMint, userRddkAta } = env;
    const position1 = stakePosition(payer.publicKey, 1);

    const stakeIx = await program.methods
      .stake(oneToken().muln(2))
      .accountsPartial({
        stakePosition: position1,
        userRddkAta,
        rddkMint,
        user: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], stakeIx);

    const pos = await program.account.stakePosition.fetch(position1);
    assert.equal(pos.amount.toString(), oneToken().muln(2).toString());
    assert.equal(pos.index.toNumber(), 1);

    const user = await program.account.userState.fetch(
      userState(payer.publicKey),
    );
    assert.equal(user.stakeCount.toNumber(), 2);
  });

  it("rejects staking zero tokens", async () => {
    const { context, program, payer, rddkMint, userRddkAta } = env;
    const position = stakePosition(payer.publicKey, 2);

    const stakeIx = await program.methods
      .stake(toBN(0))
      .accountsPartial({
        stakePosition: position,
        userRddkAta,
        rddkMint,
        user: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6000) } },
      sendIxs(context, [payer], stakeIx),
    );
  });

  it("rejects claiming before lock duration (3 days) has elapsed", async () => {
    const { context, program, payer, vrddkMint } = env;

    const userVrddkAta = getAssociatedTokenAddressSync(
      vrddkMint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    // Create user vRDDK Token-2022 ATA
    await processTransaction(
      context,
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          userVrddkAta,
          payer.publicKey,
          vrddkMint,
          TOKEN_2022_PROGRAM_ID,
        ),
      ),
      [payer],
    );

    const claimIx = await program.methods
      .claim(toBN(0))
      .accountsPartial({
        vrddkMint,
        userVrddkAta,
        user: payer.publicKey,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6001) } },
      sendIxs(context, [payer], claimIx),
    );
  });

  it("claims vRDDK after 3 days have elapsed", async () => {
    const { context, program, payer, vrddkMint } = env;

    const userVrddkAta = getAssociatedTokenAddressSync(
      vrddkMint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const now = await getTime(context);
    const threeDays = BigInt(3 * 24 * 60 * 60 + 10);
    await timeTravel(context, BigInt(now.toString()) + threeDays);

    const claimIx = await program.methods
      .claim(toBN(0))
      .accountsPartial({
        vrddkMint,
        userVrddkAta,
        user: payer.publicKey,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], claimIx);

    const pos = await program.account.stakePosition.fetch(
      stakePosition(payer.publicKey, 0),
    );
    assert.isTrue(pos.isClaimed);

    const vrddkAccount = await getAccount(
      context.banksClient as any,
      userVrddkAta,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    assert.equal(vrddkAccount.amount.toString(), oneToken().toString());
  });

  it("rejects claiming the same stake position twice", async () => {
    const { context, program, payer, vrddkMint } = env;
    const userVrddkAta = getAssociatedTokenAddressSync(
      vrddkMint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const claimIx = await program.methods
      .claim(toBN(0))
      .accountsPartial({
        vrddkMint,
        userVrddkAta,
        user: payer.publicKey,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6002) } },
      sendIxs(context, [payer], claimIx),
    );
  });

  it("unstakes by burning vRDDK and returning RDDK to the user", async () => {
    const { context, program, payer, rddkMint, vrddkMint, userRddkAta } = env;
    const userVrddkAta = getAssociatedTokenAddressSync(
      vrddkMint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const rddkBefore = await getAccount(
      context.banksClient as any,
      userRddkAta,
      undefined,
      TOKEN_PROGRAM_ID,
    );

    const unstakeIx = await program.methods
      .unstake(oneToken())
      .accountsPartial({
        vrddkMint,
        userVrddkAta,
        userRddkAta,
        rddkMint,
        user: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], unstakeIx);

    const rddkAfter = await getAccount(
      context.banksClient as any,
      userRddkAta,
      undefined,
      TOKEN_PROGRAM_ID,
    );
    assert.equal(
      (rddkAfter.amount - rddkBefore.amount).toString(),
      oneToken().toString(),
    );

    const vrddkAccount = await getAccount(
      context.banksClient as any,
      userVrddkAta,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    assert.equal(vrddkAccount.amount.toString(), "0");
  });

  it("rejects unstaking zero tokens", async () => {
    const { context, program, payer, rddkMint, vrddkMint, userRddkAta } = env;
    const userVrddkAta = getAssociatedTokenAddressSync(
      vrddkMint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const unstakeIx = await program.methods
      .unstake(toBN(0))
      .accountsPartial({
        vrddkMint,
        userVrddkAta,
        userRddkAta,
        rddkMint,
        user: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6000) } },
      sendIxs(context, [payer], unstakeIx),
    );
  });

  it("enforces that vRDDK is non-transferable", async () => {
    const { context, payer, vrddkMint } = env;
    const recipient = PublicKey.unique();

    const fromAta = getAssociatedTokenAddressSync(
      vrddkMint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const toAta = getAssociatedTokenAddressSync(
      vrddkMint,
      recipient,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    // Try creating ATA and transferring vRDDK
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        toAta,
        recipient,
        vrddkMint,
        TOKEN_2022_PROGRAM_ID,
      ),
      createTransferInstruction(
        fromAta,
        toAta,
        payer.publicKey,
        1,
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
    );

    await expectReverted(
      { revertedWith: { message: "custom program error" } },
      processTransaction(context, tx, [payer]),
    );
  });
});
