// Keep lifecycle observers that must run before normal inventory reconciliation
// ahead of the main worker. Both modules are side-effectful by design.
import "./background-recovery.js";
import "./service-worker.js";
