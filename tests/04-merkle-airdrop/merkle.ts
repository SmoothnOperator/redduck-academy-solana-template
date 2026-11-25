import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import { toBN } from "../helpers";

export interface AirdropEntry {
  account: PublicKey;
  amount: BN;
}

export const hashLeaf = (entry: AirdropEntry): Buffer => {
  return createHash("sha256")
    .update(
      Buffer.concat([
        entry.account.toBuffer(),
        toBN(entry.amount).toArrayLike(Buffer, "le", 8),
      ]),
    )
    .digest();
};

export const hashPair = (a: Buffer, b: Buffer): Buffer => {
  return a.compare(b) <= 0
    ? createHash("sha256")
        .update(Buffer.concat([a, b]))
        .digest()
    : createHash("sha256")
        .update(Buffer.concat([b, a]))
        .digest();
};

export class MerkleTree {
  leaves: Buffer[];
  layers: Buffer[][];

  constructor(entries: AirdropEntry[]) {
    this.leaves = entries.map(hashLeaf);
    this.layers = [this.leaves];

    let currentLayer = this.leaves;
    while (currentLayer.length > 1) {
      const nextLayer: Buffer[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        if (i + 1 < currentLayer.length) {
          nextLayer.push(hashPair(currentLayer[i], currentLayer[i + 1]));
        } else {
          nextLayer.push(currentLayer[i]);
        }
      }
      this.layers.push(nextLayer);
      currentLayer = nextLayer;
    }
  }

  get root(): Buffer {
    return this.layers[this.layers.length - 1][0];
  }

  getProof(index: number): Buffer[] {
    const proof: Buffer[] = [];
    let currentIdx = index;

    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i];
      const isRightNode = currentIdx % 2 === 1;
      const siblingIdx = isRightNode ? currentIdx - 1 : currentIdx + 1;

      if (siblingIdx < layer.length) {
        proof.push(layer[siblingIdx]);
      }

      currentIdx = Math.floor(currentIdx / 2);
    }

    return proof;
  }
}
