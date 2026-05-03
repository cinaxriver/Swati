// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SwatiRunTrigger {

struct RunRecord {
        bytes32 choreoId;
        bytes32 inputHash;   
        address requester;
        uint64  requestedAt;
        bool    exists;
    }

    struct ResultRecord {
        bool    success;
        bytes32 resultHash;  
        uint64  reportedAt;
        bool    exists;
    }

mapping(bytes32 => RunRecord) public runs;

mapping(bytes32 => mapping(string => ResultRecord)) public results;

mapping(bytes32 => string[]) private _reportedRoles;

event RunRequested(
        bytes32 indexed runKey,
        bytes32 indexed choreoId,
        bytes   input,
        address indexed requester
    );

event RunCompleted(
        bytes32 indexed runKey,
        string  role,
        bool    success,
        bytes   result,
        address indexed reporter
    );

error RunNotFound(bytes32 runKey);
    error ResultAlreadyReported(bytes32 runKey, string role);
    error EmptyInput();

function requestRun(
        bytes32 choreoId,
        bytes calldata input
    ) external returns (bytes32 runKey) {
        if (input.length == 0) revert EmptyInput();

        runKey = keccak256(
            abi.encodePacked(choreoId, block.timestamp, msg.sender, input)
        );

        runs[runKey] = RunRecord({
            choreoId:    choreoId,
            inputHash:   keccak256(input),
            requester:   msg.sender,
            requestedAt: uint64(block.timestamp),
            exists:      true
        });

        emit RunRequested(runKey, choreoId, input, msg.sender);
    }

function reportResult(
        bytes32 runKey,
        string calldata role,
        bool success,
        bytes calldata result
    ) external {
        if (!runs[runKey].exists) revert RunNotFound(runKey);
        if (results[runKey][role].exists) revert ResultAlreadyReported(runKey, role);

        results[runKey][role] = ResultRecord({
            success:    success,
            resultHash: keccak256(result),
            reportedAt: uint64(block.timestamp),
            exists:     true
        });

        _reportedRoles[runKey].push(role);

        emit RunCompleted(runKey, role, success, result, msg.sender);
    }

function getReportedRoles(bytes32 runKey) external view returns (string[] memory) {
        return _reportedRoles[runKey];
    }

function verifyResult(
        bytes32 runKey,
        string calldata role,
        bytes calldata result
    ) external view returns (bool) {
        ResultRecord storage rec = results[runKey][role];
        return rec.exists && rec.resultHash == keccak256(result);
    }
}
