/**
 * Setup for Higher or Lower's suite.
 *
 * Deliberately empty of stubs. What is under test here is the wire: the bytes a
 * host puts on the air, the framing that survives a stack which refused an MTU
 * request, and the protocol both ends parse. None of that touches a native
 * module, and none of it should be allowed to start — a fake radio in this file
 * is how these tests would stop meaning anything.
 */
