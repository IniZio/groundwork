// source: plugins/house-rules/test/fixtures/languages/swift.swift
// conformance: comments=27 directive=7 doc=7 groups=20
// Copyright 2024 Acme Corp. All rights reserved.
// SPDX-License-Identifier: MIT

import Foundation
import UIKit

// MARK: - Models

/// Returns the parking lot id.
/// - Returns: The unique identifier string.
func parkingLotId() -> String {
    return "PL-001"
}

/** Doc block comment for ParkingLot struct. */
struct ParkingLot {
    let id: String
    let capacity: Int
    var occupancy: Int

    // swiftlint:disable force_cast
    func typedData() -> Any {
        return NSDictionary() as! [String: Any]
    }
    // swiftlint:enable force_cast

    /// Checks if parking lot is full.
    var isFull: Bool {
        return occupancy >= capacity
    }
}

// MARK: - Protocols

/// A protocol for entities that can be identified.
protocol Identifiable {
    /// The unique identifier.
    var id: String { get }
}

// MARK: - Extensions

extension ParkingLot: Identifiable {}

// MARK: - Lifecycle

/// Base view controller for parking management screens.
class ParkingViewController: UIViewController {

    #if DEBUG
    // Debug-only helper for testing
    func debugReset() {
        print("reset called")
    }
    #endif

    override func viewDidLoad() {
        super.viewDidLoad()
        // swiftlint:disable:next line_length
        let longMessage = "This is a very long message that would exceed the line length limit set by SwiftLint but is needed here"
        _ = longMessage
    }

    @available(iOS 15, *)
    func modernSetup() {
        // Plain comment about modern setup
        let config = UIContentUnavailableConfiguration.empty()
        _ = config
    }

    func rawStrings() {
        let s = #"raw string with // not a comment inside"#
        let multiline = """
        This contains // not a comment
        and /* also not */ a comment
        """
        _ = s
        _ = multiline
    }

    // TODO(WP-12): fix memory leak in dealloc
    func cleanup() {
        // TODO: fix later
        // https://developer.apple.com/documentation/uikit
        // -----
        // A plain comment about cleanup
        _ = #selector(cleanup)
        if #available(iOS 15, *) {
            // Available check branch comment
            print("iOS 15+")
        }
    }
}

//// not doc — four slashes
let notDoc = "value"
