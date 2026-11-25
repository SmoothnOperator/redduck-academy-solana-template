import {
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  AccountLayout,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";

import {
  sendIxs,
  findPDA,
  expectReverted,
  numToHex,
  oneToken,
  toBN,
} from "../helpers";
import { setupAirdrop, MerkleFixture } from "./fixture";
import { buildClaimSignatureIx } from "./signatures";

describe("04-merkle-airdrop", () => {
  let env: MerkleFixture;

  const claimPda = (claimant: PublicKey): PublicKey =>
    findPDA(["claim", claimant], env.program)[0];

  before(async () => {
    env = await setupAirdrop();
  });

  it("claims an allocation with a valid Merkle proof", async () => {
    const { context, program, mint, vault, entries, tree, claimants } = env;

    const claimant = claimants[0];
    const amount = entries[0].amount;
    const proof = tree.getProof(0).map((node) => [...node]);
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    const ix = await program.methods
      .claim(amount, proof)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendIxs(context, [claimant], ix);

    const acc = await context.banksClient.getAccount(claimantAta);
    const balance = AccountLayout.decode(acc!.data).amount;
    assert.equal(balance.toString(), amount.toString());
  });

  it("rejects an invalid Merkle proof", async () => {
    const { context, program, mint, vault, tree, claimants } = env;
    const claimant = claimants[1];
    const wrongAmount = oneToken().muln(5); // wrong amount
    const proof = tree.getProof(1).map((node) => [...node]);
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    const ix = await program.methods
      .claim(wrongAmount, proof)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6000) } }, // InvalidProof = 6000
      sendIxs(context, [claimant], ix),
    );
  });

  it("rejects claiming twice with a Merkle proof", async () => {
    const { context, program, mint, vault, entries, tree, claimants } = env;
    const claimant = claimants[0]; // already claimed in first test
    const amount = entries[0].amount;
    const proof = tree.getProof(0).map((node) => [...node]);
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    const ix = await program.methods
      .claim(amount, proof)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "custom program error" } },
      sendIxs(context, [claimant], ix),
    );
  });

  it("claims an allocation with a valid signature from trusted authority", async () => {
    const { context, program, mint, vault, signer, claimants } = env;
    const claimant = claimants[2];
    const amount = oneToken();
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    const ed25519Ix = buildClaimSignatureIx(
      signer,
      claimant.publicKey,
      amount,
      program.programId,
    );

    const claimIx = await program.methods
      .claimWithSignature(amount)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    await sendIxs(context, [claimant], ed25519Ix, claimIx);

    const acc = await context.banksClient.getAccount(claimantAta);
    const balance = AccountLayout.decode(acc!.data).amount;
    assert.equal(balance.toString(), amount.toString());
  });

  it("rejects claiming via signature if already claimed via Merkle proof", async () => {
    const { context, program, mint, vault, signer, claimants } = env;
    const claimant = claimants[0]; // already claimed via Merkle proof
    const amount = oneToken();
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    const ed25519Ix = buildClaimSignatureIx(
      signer,
      claimant.publicKey,
      amount,
      program.programId,
    );

    const claimIx = await program.methods
      .claimWithSignature(amount)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "custom program error" } },
      sendIxs(context, [claimant], ed25519Ix, claimIx),
    );
  });

  it("rejects claiming via Merkle proof if already claimed via signature", async () => {
    const { context, program, mint, vault, tree, claimants } = env;
    const claimant = claimants[2]; // already claimed via signature in earlier test
    const amount = oneToken();
    const proof = tree.getProof(2).map((node) => [...node]);
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    const ix = await program.methods
      .claim(amount, proof)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "custom program error" } },
      sendIxs(context, [claimant], ix),
    );
  });

  it("rejects signature signed by an untrusted signer", async () => {
    const { context, program, mint, vault, claimants } = env;
    const claimant = claimants[3];
    const amount = oneToken();
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);
    const fakeSigner = Keypair.generate();

    const ed25519Ix = buildClaimSignatureIx(
      fakeSigner,
      claimant.publicKey,
      amount,
      program.programId,
    );

    const claimIx = await program.methods
      .claimWithSignature(amount)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6001) } }, // SignatureVerificationFailed = 6001
      sendIxs(context, [claimant], ed25519Ix, claimIx),
    );
  });

  it("rejects signature signed for a different claimant", async () => {
    const { context, program, mint, vault, signer, claimants } = env;
    const claimant = claimants[3];
    const otherUser = Keypair.generate();
    const amount = oneToken();
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    const ed25519Ix = buildClaimSignatureIx(
      signer,
      otherUser.publicKey, // signed for other user
      amount,
      program.programId,
    );

    const claimIx = await program.methods
      .claimWithSignature(amount)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6001) } },
      sendIxs(context, [claimant], ed25519Ix, claimIx),
    );
  });

  it("rejects signature signed for a different amount", async () => {
    const { context, program, mint, vault, signer, claimants } = env;
    const claimant = claimants[3];
    const amount = oneToken();
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    const ed25519Ix = buildClaimSignatureIx(
      signer,
      claimant.publicKey,
      oneToken().muln(100), // signed for 100 tokens
      program.programId,
    );

    const claimIx = await program.methods
      .claimWithSignature(amount) // claiming 1 token
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6001) } },
      sendIxs(context, [claimant], ed25519Ix, claimIx),
    );
  });

  it("rejects signature signed for a different program ID", async () => {
    const { context, program, mint, vault, signer, claimants } = env;
    const claimant = claimants[3];
    const amount = oneToken();
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);
    const wrongProgramId = Keypair.generate().publicKey;

    const ed25519Ix = buildClaimSignatureIx(
      signer,
      claimant.publicKey,
      amount,
      wrongProgramId,
    );

    const claimIx = await program.methods
      .claimWithSignature(amount)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6001) } },
      sendIxs(context, [claimant], ed25519Ix, claimIx),
    );
  });

  it("rejects claiming zero amount with a Merkle proof", async () => {
    const { context, program, mint, vault, tree, claimants } = env;
    const claimant = claimants[3];
    const amount = toBN(0);
    const proof = tree.getProof(3).map((node) => [...node]);
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    const ix = await program.methods
      .claim(amount, proof)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6003) } }, // ZeroAmount = 6003
      sendIxs(context, [claimant], ix),
    );
  });

  it("rejects claiming zero amount with a signature", async () => {
    const { context, program, mint, vault, signer, claimants } = env;
    const claimant = claimants[3];
    const amount = toBN(0);
    const claimantAta = getAssociatedTokenAddressSync(mint, claimant.publicKey);

    const ed25519Ix = buildClaimSignatureIx(
      signer,
      claimant.publicKey,
      amount,
      program.programId,
    );

    const claimIx = await program.methods
      .claimWithSignature(amount)
      .accountsPartial({
        claim: claimPda(claimant.publicKey),
        claimant: claimant.publicKey,
        claimantAta,
        mint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: numToHex(6003) } }, // ZeroAmount = 6003
      sendIxs(context, [claimant], ed25519Ix, claimIx),
    );
  });

  it("rejects re-running initialize on the same config (one-time initialization)", async () => {
    const { context, program, payer, mint, tree, signer } = env;

    const initIx = await program.methods
      .initialize([...tree.root], signer.publicKey)
      .accountsPartial({
        mint,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await expectReverted(
      { revertedWith: { message: "custom program error" } },
      sendIxs(context, [payer], initIx),
    );
  });
});
