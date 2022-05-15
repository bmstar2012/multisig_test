// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

const anchor = require("@project-serum/anchor");

module.exports = async function (provider) {
  // Configure client to use the provider.
  anchor.setProvider(provider);

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

  console.log(`ownerA: ${ownerA.publicKey.toString()}`);
  console.log(`ownerB: ${ownerB.publicKey.toString()}`);
  console.log(`ownerC: ${ownerC.publicKey.toString()}`);
  console.log(`ownerD: ${ownerD.publicKey.toString()}`);
  console.log(`multisigAccount: ${multisigAccount.publicKey.toString()}`);
  console.log(`transactionAccount: ${transactionAccount.publicKey.toString()}`);

  const initialize = async() => {
    [multisigSigner, nonce] =
      await anchor.web3.PublicKey.findProgramAddress(
        [multisigAccount.publicKey.toBuffer()],
        program.programId
      );
    console.log(`multisigSigner: ${multisigSigner.toString()}`);
    await program.methods
      .createMultisig(owners, threshold, nonce)
      .accounts({
        multisig: multisigAccount.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .preInstructions([
        await program.account.multisig.createInstruction(
          multisigAccount,
          multisigAccountSize
        ),
      ])
      .signers([multisigAccount])
      .rpc();

    multisigAccountInfo = await program.account.multisig.fetch(
      multisigAccount.publicKey
    );
  }

  const creatTransaction = async () => {
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
    await program.methods
      .createTransaction(pid, accounts, data)
      .accounts({
        multisig: multisigAccount.publicKey,
        transaction: transactionAccount.publicKey,
        proposer: ownerA.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .preInstructions([
        await program.account.transaction.createInstruction(
          transactionAccount,
          txAccountSize
        ),
      ])
      .signers([transactionAccount, ownerA])
      .rpc();

    const txAccount = await program.account.transaction.fetch(
      transactionAccount.publicKey
    );
  }

  const approve = async () => {
    await program.methods
      .approve()
      .accounts({
        multisig: multisigAccount.publicKey,
        transaction: transactionAccount.publicKey,
        owner: ownerB.publicKey,
      })
      .signers([ownerB])
      .rpc();
  }

  const execute = async () => {
    await program.methods
      .executeTransaction()
      .accounts({
        multisig: multisigAccount.publicKey,
        multisigSigner,
        transaction: transactionAccount.publicKey,
      })
      .remainingAccounts(program.instruction.setOwners
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
        }))
      .rpc();

    multisigAccountInfo = await program.account.multisig.fetch(multisigAccount.publicKey);
  }

  await initialize();
  console.log(`Init`);

  await creatTransaction();
  console.log(`Create transaction`);

  await approve();
  console.log(`Approve`);

  await execute();
  console.log(`Execute`);
};
