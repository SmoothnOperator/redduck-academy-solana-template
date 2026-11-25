import { BN } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  AccountLayout,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { assert } from "chai";

import {
  sendIxs,
  findPDA,
  toBN,
  timeTravel,
  getTime,
  expectReverted,
  numToHex,
  oneToken,
} from "../helpers";
import { setupRaffle, fulfillRandomness, RaffleFixture } from "./fixture";

describe("05-raffle", () => {
  let env: RaffleFixture;

  const rafflePda = () => findPDA(["raffle"], env.program)[0];
  const vaultPda = () => findPDA(["vault"], env.program)[0];
  const entryPda = (index: number | BN) =>
    findPDA(
      ["entry", toBN(index).toArrayLike(Buffer, "le", 8)],
      env.program,
    )[0];

  const fundEntrant = async (
    entrant: Keypair,
    amount: BN,
  ): Promise<PublicKey> => {
    const ata = getAssociatedTokenAddressSync(env.mint, entrant.publicKey);
    const ix1 = createAssociatedTokenAccountInstruction(
      env.payer.publicKey,
      ata,
      entrant.publicKey,
      env.mint,
    );
    const ix2 = createMintToInstruction(
      env.mint,
      ata,
      env.payer.publicKey,
      BigInt(amount.toString()),
    );
    await sendIxs(env.context, [env.payer], ix1, ix2);
    return ata;
  };

  beforeEach(async () => {
    env = await setupRaffle();
  });

  it("draws a weighted winner who takes the whole pot", async () => {
    const { context, program, payer, oracle, mint, randomness, funded } = env;

    const now = await getTime(context);
    const drawTime = now + 3600n;

    // 1. Initialize the raffle
    const initIx = await program.methods
      .initialize(toBN(drawTime), oracle.publicKey)
      .accountsPartial({
        raffle: rafflePda(),
        randomness,
        vault: vaultPda(),
        mint,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], initIx);

    // Verify initial raffle state
    const raffleStateBefore = await program.account.raffle.fetch(rafflePda());
    assert.equal(
      raffleStateBefore.oracle.toBase58(),
      oracle.publicKey.toBase58(),
    );
    assert.equal(raffleStateBefore.drawTime.toString(), drawTime.toString());
    assert.equal(raffleStateBefore.totalDeposited.toString(), "0");
    assert.equal(raffleStateBefore.entryCount.toString(), "0");
    assert.isFalse(raffleStateBefore.claimed);

    // 2. Entrants deposit different amounts
    const entrant0 = funded[0];
    const amount0 = oneToken(); // 1 token
    const ata0 = await fundEntrant(entrant0, amount0);

    const dep0Ix = await program.methods
      .deposit(amount0)
      .accountsPartial({
        raffle: rafflePda(),
        entry: entryPda(0),
        vault: vaultPda(),
        entrantTokenAccount: ata0,
        mint,
        entrant: entrant0.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [entrant0], dep0Ix);

    const entrant1 = funded[1];
    const amount1 = oneToken().muln(2); // 2 tokens
    const ata1 = await fundEntrant(entrant1, amount1);

    const dep1Ix = await program.methods
      .deposit(amount1)
      .accountsPartial({
        raffle: rafflePda(),
        entry: entryPda(1),
        vault: vaultPda(),
        entrantTokenAccount: ata1,
        mint,
        entrant: entrant1.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [entrant1], dep1Ix);

    const entrant2 = funded[2];
    const amount2 = oneToken().muln(3); // 3 tokens
    const ata2 = await fundEntrant(entrant2, amount2);

    const dep2Ix = await program.methods
      .deposit(amount2)
      .accountsPartial({
        raffle: rafflePda(),
        entry: entryPda(2),
        vault: vaultPda(),
        entrantTokenAccount: ata2,
        mint,
        entrant: entrant2.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [entrant2], dep2Ix);

    // Verify deposits and cumulative accounting
    const raffleAfterDeps = await program.account.raffle.fetch(rafflePda());
    const totalDeposited = amount0.add(amount1).add(amount2);
    assert.equal(
      raffleAfterDeps.totalDeposited.toString(),
      totalDeposited.toString(),
    );
    assert.equal(raffleAfterDeps.entryCount.toString(), "3");

    // 3. Fast-forward past deadline
    await timeTravel(context, drawTime + 10n);

    // 4. Oracle callback delivers 32-byte VRF randomness
    const randomBytes = Array.from({ length: 32 }, (_, i) => i);
    await fulfillRandomness(env, randomBytes);

    const randAccount = await program.account.randomness.fetch(randomness);
    assert.isTrue(randAccount.fulfilled);

    // 5. Calculate winning entry
    const randomBuf = Buffer.from(randomBytes.slice(0, 16));
    const randomVal =
      randomBuf.readBigUInt64LE(0) + (randomBuf.readBigUInt64LE(8) << 64n);
    const winningTicket = randomVal % BigInt(totalDeposited.toString());

    let winningIndex = 0;
    if (winningTicket < BigInt(amount0.toString())) {
      winningIndex = 0;
    } else if (winningTicket < BigInt(amount0.add(amount1).toString())) {
      winningIndex = 1;
    } else {
      winningIndex = 2;
    }

    const winners = [entrant0, entrant1, entrant2];
    const winnerAtas = [ata0, ata1, ata2];
    const winner = winners[winningIndex];
    const winnerAta = winnerAtas[winningIndex];

    // 6. Winner claims prize
    const claimIx = await program.methods
      .claim(toBN(winningIndex))
      .accountsPartial({
        raffle: rafflePda(),
        randomness,
        entry: entryPda(winningIndex),
        vault: vaultPda(),
        destination: winnerAta,
        mint,
        winner: winner.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [winner], claimIx);

    // 7. Verify vault is empty and winner received the entire pot
    const vaultAcc = await context.banksClient.getAccount(vaultPda());
    const vaultBalance = AccountLayout.decode(vaultAcc!.data).amount;
    assert.equal(vaultBalance.toString(), "0");

    const winnerAcc = await context.banksClient.getAccount(winnerAta);
    const winnerBalance = AccountLayout.decode(winnerAcc!.data).amount;
    assert.equal(winnerBalance.toString(), totalDeposited.toString());

    const raffleFinal = await program.account.raffle.fetch(rafflePda());
    assert.isTrue(raffleFinal.claimed);
  });

  it("rejects an invalid claim with incorrect winner information or non-winning entry", async () => {
    const { context, program, payer, oracle, mint, randomness, funded } = env;

    const now = await getTime(context);
    const drawTime = now + 3600n;

    const initIx = await program.methods
      .initialize(toBN(drawTime), oracle.publicKey)
      .accountsPartial({
        raffle: rafflePda(),
        randomness,
        vault: vaultPda(),
        mint,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], initIx);

    const entrant0 = funded[0];
    const amount0 = oneToken();
    const ata0 = await fundEntrant(entrant0, amount0);

    const dep0Ix = await program.methods
      .deposit(amount0)
      .accountsPartial({
        raffle: rafflePda(),
        entry: entryPda(0),
        vault: vaultPda(),
        entrantTokenAccount: ata0,
        mint,
        entrant: entrant0.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [entrant0], dep0Ix);

    const entrant1 = funded[1];
    const amount1 = oneToken().muln(5);
    const ata1 = await fundEntrant(entrant1, amount1);

    const dep1Ix = await program.methods
      .deposit(amount1)
      .accountsPartial({
        raffle: rafflePda(),
        entry: entryPda(1),
        vault: vaultPda(),
        entrantTokenAccount: ata1,
        mint,
        entrant: entrant1.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [entrant1], dep1Ix);

    await timeTravel(context, drawTime + 10n);

    // Random bytes where ticket lands in entry 1 (range [1_000_000, 6_000_000))
    const randomBytes = Array.from({ length: 32 }, (_, i) => i);
    await fulfillRandomness(env, randomBytes);

    // Entrant 0 attempts to claim with non-winning entry 0
    const nonWinningClaimIx = await program.methods
      .claim(toBN(0))
      .accountsPartial({
        raffle: rafflePda(),
        randomness,
        entry: entryPda(0),
        vault: vaultPda(),
        destination: ata0,
        mint,
        winner: entrant0.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6008) } }, // NotWinner
      sendIxs(context, [entrant0], nonWinningClaimIx),
    );

    // Attacker attempts to claim winning entry 1 with wrong signer
    const attacker = funded[3];
    const attackerAta = await fundEntrant(attacker, oneToken());
    const forgedClaimIx = await program.methods
      .claim(toBN(1))
      .accountsPartial({
        raffle: rafflePda(),
        randomness,
        entry: entryPda(1),
        vault: vaultPda(),
        destination: attackerAta,
        mint,
        winner: attacker.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6008) } }, // NotWinner
      sendIxs(context, [attacker], forgedClaimIx),
    );
  });

  it("enforces single-use semantics by rejecting duplicate claims", async () => {
    const { context, program, payer, oracle, mint, randomness, funded } = env;

    const now = await getTime(context);
    const drawTime = now + 3600n;

    const initIx = await program.methods
      .initialize(toBN(drawTime), oracle.publicKey)
      .accountsPartial({
        raffle: rafflePda(),
        randomness,
        vault: vaultPda(),
        mint,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], initIx);

    const entrant = funded[0];
    const amount = oneToken();
    const ata = await fundEntrant(entrant, amount);

    const depIx = await program.methods
      .deposit(amount)
      .accountsPartial({
        raffle: rafflePda(),
        entry: entryPda(0),
        vault: vaultPda(),
        entrantTokenAccount: ata,
        mint,
        entrant: entrant.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [entrant], depIx);

    await timeTravel(context, drawTime + 10n);
    await fulfillRandomness(
      env,
      Array.from({ length: 32 }, () => 0),
    );

    const claimIx = await program.methods
      .claim(toBN(0))
      .accountsPartial({
        raffle: rafflePda(),
        randomness,
        entry: entryPda(0),
        vault: vaultPda(),
        destination: ata,
        mint,
        winner: entrant.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    // First claim succeeds
    await sendIxs(context, [entrant], claimIx);

    // Second claim must fail with AlreadyClaimed (6007)
    await expectReverted(
      { revertedWith: { message: numToHex(6007) } },
      sendIxs(context, [entrant], claimIx),
    );
  });

  it("enforces deadline by rejecting deposits after draw time", async () => {
    const { context, program, payer, oracle, mint, randomness, funded } = env;

    const now = await getTime(context);
    const drawTime = now + 100n;

    const initIx = await program.methods
      .initialize(toBN(drawTime), oracle.publicKey)
      .accountsPartial({
        raffle: rafflePda(),
        randomness,
        vault: vaultPda(),
        mint,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [payer], initIx);

    // Fast-forward past deadline
    await timeTravel(context, drawTime + 10n);

    const entrant = funded[0];
    const amount = oneToken();
    const ata = await fundEntrant(entrant, amount);

    const depIx = await program.methods
      .deposit(amount)
      .accountsPartial({
        raffle: rafflePda(),
        entry: entryPda(0),
        vault: vaultPda(),
        entrantTokenAccount: ata,
        mint,
        entrant: entrant.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6002) } }, // RaffleEnded
      sendIxs(context, [entrant], depIx),
    );
  });

  it("enforces one-time initialization guard on the raffle config", async () => {
    const { context, program, payer, oracle, mint, randomness } = env;

    const now = await getTime(context);
    const drawTime = now + 3600n;

    const initIx = await program.methods
      .initialize(toBN(drawTime), oracle.publicKey)
      .accountsPartial({
        raffle: rafflePda(),
        randomness,
        vault: vaultPda(),
        mint,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    // First initialization succeeds
    await sendIxs(context, [payer], initIx);

    // Second initialization on the same config fails
    await expectReverted(
      { revertedWith: { message: "custom program error" } },
      sendIxs(context, [payer], initIx),
    );
  });
});
