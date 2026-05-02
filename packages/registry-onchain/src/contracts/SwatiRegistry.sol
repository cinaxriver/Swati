// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SwatiRegistry {
  struct ChoreographyRecord {
    string name;
    bytes32 manifestHash;
    string sourceUri;
    string manifestUri;
    address publisher;
    uint64 registeredAt;
    uint8 roleCount;
    bool exists;
  }

  struct RoleRecord {
    bytes32 pubkeyHash;
    string ensName;
    string axlPeerId;
    uint64 registeredAt;
    bool exists;
  }

  struct LogAnchor {
    bytes32 logRootHash;
    string logUri;
    address anchoredBy;
    uint64 anchoredAt;
  }

  mapping(bytes32 => ChoreographyRecord) public choreographies;

  mapping(bytes32 => mapping(string => RoleRecord)) public roleIdentities;

  mapping(bytes32 => string[]) private _choreoRoles;

  mapping(bytes32 => mapping(bytes32 => bool)) public invokeLinks;

  mapping(bytes32 => bytes32[]) private _invokedByList;

  mapping(bytes32 => bytes32[]) private _invokesList;

  mapping(bytes32 => LogAnchor[]) private _logAnchors;

  mapping(address => bytes32[]) private _publisherChoreos;

  event ChoreographyRegistered(
    bytes32 indexed choreoId,
    string name,
    bytes32 manifestHash,
    address indexed publisher
  );

  event RoleRegistered(bytes32 indexed choreoId, string role, bytes32 pubkeyHash, string ensName);

  event InvokeLinked(bytes32 indexed parentId, bytes32 indexed childId, address indexed linkedBy);

  event LogAnchored(
    bytes32 indexed choreoId,
    bytes32 logRootHash,
    string logUri,
    address indexed anchoredBy
  );

  error AlreadyRegistered(bytes32 choreoId);
  error NotFound(bytes32 choreoId);
  error NotPublisher(bytes32 choreoId, address caller);
  error AlreadyLinked(bytes32 parentId, bytes32 childId);
  error RoleNotInChoreography(bytes32 choreoId, string role);

  function registerChoreography(
    bytes32 manifestHash,
    string calldata name,
    string[] calldata roles,
    string calldata sourceUri,
    string calldata manifestUri
  ) external returns (bytes32 choreoId) {
    choreoId = manifestHash;
    if (choreographies[choreoId].exists) revert AlreadyRegistered(choreoId);

    choreographies[choreoId] = ChoreographyRecord({
      name: name,
      manifestHash: manifestHash,
      sourceUri: sourceUri,
      manifestUri: manifestUri,
      publisher: msg.sender,
      registeredAt: uint64(block.timestamp),
      roleCount: uint8(roles.length),
      exists: true
    });

    for (uint i = 0; i < roles.length; i++) {
      _choreoRoles[choreoId].push(roles[i]);
    }

    _publisherChoreos[msg.sender].push(choreoId);

    emit ChoreographyRegistered(choreoId, name, manifestHash, msg.sender);
  }

  function registerRole(
    bytes32 choreoId,
    string calldata role,
    bytes32 pubkeyHash,
    string calldata ensName,
    string calldata axlPeerId
  ) external {
    if (!choreographies[choreoId].exists) revert NotFound(choreoId);
    if (choreographies[choreoId].publisher != msg.sender) revert NotPublisher(choreoId, msg.sender);
    if (!_hasRole(choreoId, role)) revert RoleNotInChoreography(choreoId, role);

    roleIdentities[choreoId][role] = RoleRecord({
      pubkeyHash: pubkeyHash,
      ensName: ensName,
      axlPeerId: axlPeerId,
      registeredAt: uint64(block.timestamp),
      exists: true
    });

    emit RoleRegistered(choreoId, role, pubkeyHash, ensName);
  }

  function linkInvoke(bytes32 parentId, bytes32 childId) external {
    if (!choreographies[parentId].exists) revert NotFound(parentId);
    if (!choreographies[childId].exists) revert NotFound(childId);
    if (choreographies[parentId].publisher != msg.sender) revert NotPublisher(parentId, msg.sender);
    if (invokeLinks[parentId][childId]) revert AlreadyLinked(parentId, childId);

    invokeLinks[parentId][childId] = true;
    _invokesList[parentId].push(childId);
    _invokedByList[childId].push(parentId);

    emit InvokeLinked(parentId, childId, msg.sender);
  }

  function anchorLog(bytes32 choreoId, bytes32 logRootHash, string calldata logUri) external {
    if (!choreographies[choreoId].exists) revert NotFound(choreoId);

    _logAnchors[choreoId].push(
      LogAnchor({
        logRootHash: logRootHash,
        logUri: logUri,
        anchoredBy: msg.sender,
        anchoredAt: uint64(block.timestamp)
      })
    );

    emit LogAnchored(choreoId, logRootHash, logUri, msg.sender);
  }

  function verifyRole(
    bytes32 choreoId,
    string calldata role,
    bytes32 pubkeyHash
  ) external view returns (bool) {
    RoleRecord storage rec = roleIdentities[choreoId][role];
    return rec.exists && rec.pubkeyHash == pubkeyHash;
  }

  function canInvoke(bytes32 parentId, bytes32 childId) external view returns (bool) {
    return invokeLinks[parentId][childId];
  }

  function getPublisherChoreos(address publisher) external view returns (bytes32[] memory) {
    return _publisherChoreos[publisher];
  }

  function getChoreoRoles(bytes32 choreoId) external view returns (string[] memory) {
    return _choreoRoles[choreoId];
  }

  function getInvokeList(bytes32 choreoId) external view returns (bytes32[] memory) {
    return _invokesList[choreoId];
  }

  function getInvokedByList(bytes32 choreoId) external view returns (bytes32[] memory) {
    return _invokedByList[choreoId];
  }

  function getLogAnchors(bytes32 choreoId) external view returns (LogAnchor[] memory) {
    return _logAnchors[choreoId];
  }

  function choreoIdFromHex(bytes32 manifestHashBytes) external pure returns (bytes32) {
    return manifestHashBytes;
  }

  function _hasRole(bytes32 choreoId, string calldata role) internal view returns (bool) {
    string[] storage roles = _choreoRoles[choreoId];
    for (uint i = 0; i < roles.length; i++) {
      if (keccak256(bytes(roles[i])) == keccak256(bytes(role))) return true;
    }
    return false;
  }
}
