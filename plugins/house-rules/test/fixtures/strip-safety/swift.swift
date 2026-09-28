// swift-tools-version:5.9
// strip-safety: removed=4
import Foundation

// MARK: - Lifecycle

protocol AutoMockable {}

// sourcery: AutoMockable
class MyService {
    // swiftlint:disable force_cast
    let value = 42 as! Int

    // swiftlint:disable:next line_length
    func doSomethingWithAVeryLongMethodNameThatExceedsLineLength(parameter: String) -> String { parameter }

    // swift-format-ignore
    func formatted()    ->    String { "hello" }

    // swiftformat:disable all
    func legacy() {}

    // periphery:ignore
    func unused() {}

    /// Returns the description of this service.
    func description() -> String {
        // This plain comment explains the return value below.
        return "MyService"
    }

    /**
     * Initializes the service with default values.
     * This doc block should always be kept.
     */
    init() {
        // Plain comment before raw string.
        let s = #"raw // not a comment"#
        // Plain comment before multiline string.
        let ml = """
        // inside multiline string
        hello
        """
        /* a /* b */ c */
        // Plain comment before availability check.
        if #available(iOS 15, *) {
            _ = #selector(MyService.unused)
        }
        #if DEBUG
        let _debug = true
        #endif
        // Plain comment at end of init.
        _ = ml
        _ = s
    }
}
