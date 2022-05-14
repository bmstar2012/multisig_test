const anchor = require("@project-serum/anchor");
const {assert} = require("chai");

describe("multisig", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Multisig;

  const multisigAccount = anchor.web3.Keypair.generate();
  let multisigSigner, nonce;
  const multisigAccountSize = 200; // Big enough.

  const ownerA = anchor.web3.Keypair.generate();
  const ownerB = anchor.web3.Keypair.generate();
  const ownerC = anchor.web3.Keypair.generate();
  const ownerD = anchor.web3.Keypair.generate();
  const owners = [ownerA.publicKey, ownerB.publicKey, ownerC.publicKey];
  const threshold = new anchor.BN(2);
  const transactionAccount = anchor.web3.Keypair.generate();
  const newOwners = [ownerA.publicKey, ownerB.publicKey, ownerD.publicKey];
  let multisigAccountInfo;

  it('Initialize', async () => {
    [multisigSigner, nonce] =
      await anchor.web3.PublicKey.findProgramAddress(
        [multisigAccount.publicKey.toBuffer()],
        program.programId
      );
    await program.rpc.createMultisig(owners, threshold, nonce, {
      accounts: {
        multisig: multisigAccount.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      instructions: [
        await program.account.multisig.createInstruction(
          multisigAccount,
          multisigAccountSize
        ),
      ],
      signers: [multisigAccount],
    });
    multisigAccountInfo = await program.account.multisig.fetch(
      multisigAccount.publicKey
    );

    assert.strictEqual(multisigAccountInfo.nonce, nonce);
    assert.isTrue(multisigAccountInfo.threshold.eq(new anchor.BN(2)));
    assert.deepEqual(multisigAccountInfo.owners, owners);
  });

  it('Create transaction', async () => {
    const pid = program.programId;
    // The accounts of set_owners instruction
    const accounts = [
      {
        pubkey: multisigAccount.publicKey,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: multisigSigner,
        isWritable: false,
        isSigner: true,
      },
    ];
    const data = program.coder.instruction.encode("set_owners", {
      owners: newOwners,
    });

    const txAccountSize = 1000; // Big enough, cuz I'm lazy.
    await program.rpc.createTransaction(pid, accounts, data, {
      accounts: {
        multisig: multisigAccount.publicKey,
        transaction: transactionAccount.publicKey,
        proposer: ownerA.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      instructions: [
        await program.account.transaction.createInstruction(
          transactionAccount,
          txAccountSize
        ),
      ],
      signers: [transactionAccount, ownerA],
    });

    const txAccount = await program.account.transaction.fetch(
      transactionAccount.publicKey
    );

    assert.isTrue(txAccount.programId.equals(pid));
    assert.deepEqual(txAccount.accounts, accounts);
    assert.deepEqual(txAccount.data, data);
    assert.isTrue(txAccount.multisig.equals(multisigAccount.publicKey));
    assert.strictEqual(txAccount.didExecute, false);
  })

  it('Approve', async () => {
    // Other owner approves transaction.
    await program.rpc.approve({
      accounts: {
        multisig: multisigAccount.publicKey,
        transaction: transactionAccount.publicKey,
        owner: ownerB.publicKey,
      },
      signers: [ownerB],
    });
  })

  it("Execute transaction", async () => {
    // Now that we've reached the threshold, send the transaction.
    await program.rpc.executeTransaction({
      accounts: {
        multisig: multisigAccount.publicKey,
        multisigSigner,
        transaction: transactionAccount.publicKey,
      },
      remainingAccounts: program.instruction.setOwners
        .accounts({
          multisig: multisigAccount.publicKey,
          multisigSigner,
        })
        // Change the signer status on the vendor signer since it's signed by the program, not the client.
        .map((meta) =>
          meta.pubkey.equals(multisigSigner)
            ? {...meta, isSigner: false}
            : meta
        )
        .concat({
          pubkey: program.programId,
          isWritable: false,
          isSigner: false,
        }),
    });

    multisigAccountInfo = await program.account.multisig.fetch(multisigAccount.publicKey);

    assert.strictEqual(multisigAccountInfo.nonce, nonce);
    assert.isTrue(multisigAccountInfo.threshold.eq(new anchor.BN(2)));
    assert.deepEqual(multisigAccountInfo.owners, newOwners);
  });
});
