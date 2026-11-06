# Isolated manual CCTP browser fixtures

These synthetic deployment addresses, qualification flags and public test keys
are valid only in the runner's owned loopback build. They are not deployment or
Phantom extension qualification evidence. Never deploy the generated build.

`solana-golden.json` is the canonical offline fixture generated from Circle's
IDL at ec16e95d28ee47f7832df4203ae07b5981d146fc (IDL SHA256
46c195982ce970f90131f79e9b86eeadcb0d589d08f701f5506aa8ad4fa9e81d).
The fixture pins the instruction bytes and account metas for the deterministic
public test identities below.
The owner key uses public deterministic Ed25519 seed bytes 01 repeated 32 times.
The synthetic attester uses public deterministic secp256k1 bytes 03 repeated 32
times. None is a credential or funded account.

The app builds and partially signs the actual IDL transaction. The fixture
Phantom protocol verifies the event signature and signs the same message. The
source fixture accepts only genuine two-signature bytes, derives the finalized
RPC response from those bytes and appends source-shaped token/send-message/event
CPIs. An irrelevant CPI precedes the burn event so occurrence IDs must use the
full inner ordinal. No source program executes in these RPC fixtures.

Arc RPC checks exact preflight ABI calls. It validates synthetic attestation
cryptography for the transmitter and helper call boundary, checks the explicit
caller, and can reject either simulation. It does not execute Arc EVM bytecode.
The production source, fee, readiness, attestation and bundle validation runs
unchanged. Only the owned copy's public/private registry JSONs are replaced.

The runner records source/lock/test/fixture/build identities, separate ordinary
and helper collection, command exits, Playwright traces and service evidence.
It clones only matching installed dependencies and never reuses servers or sends
upstream requests from fixture services. Browser routes for unrelated existing
features use the repository's ordinary network fixtures.
