/// This is a doc comment
/// spanning multiple lines
pub struct Foo {
    /// field doc
    pub x: i32,
}

impl Foo {
    //! Inner doc
    pub fn new() -> Self {
        // regular comment
        Foo { x: 0 }
    }
}
