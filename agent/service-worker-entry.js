// Register lifecycle observers before normal inventory reconciliation.
// These modules are intentionally side-effectful: the entrypoint defines their
// listener order without turning the main worker into a monolith.
import "./background-recovery.js";
import "./background-install-review.js";
import "./service-worker.js";
