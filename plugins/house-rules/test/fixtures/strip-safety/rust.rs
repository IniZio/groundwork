// source: test/fixtures/languages/rust.rs (extended with strip-safety corpus)
// strip-safety: removed=16
//! Inner doc comment for the module — describes the whole crate.
//! This crate provides a bounded channel with backpressure support.

use std::collections::VecDeque;
// Import the sync primitives we need for the mutex and condvar pair.
use std::sync::{Arc, Condvar, Mutex};
// Thread-local storage key for per-thread send statistics.
use std::thread;

/// Capacity limit for the channel; senders block when the queue is full.
const DEFAULT_CAPACITY: usize = 64;

/**
 * A bounded, blocking multi-producer multi-consumer channel.
 *
 * Senders block when the internal buffer is at capacity.
 * Receivers block when the buffer is empty.
 */
pub struct BoundedChannel<T> {
    // Shared inner state guarded by the mutex.
    inner: Arc<(Mutex<Inner<T>>, Condvar, Condvar)>,
}

struct Inner<T> {
    // Ring buffer backing the channel.
    buf: VecDeque<T>,
    // Maximum number of items the buffer may hold at once.
    cap: usize,
    // True once every sender handle has been dropped.
    closed: bool,
}

impl<T> BoundedChannel<T> {
    /// Constructs a new channel with the given capacity.
    pub fn new(cap: usize) -> (Sender<T>, Receiver<T>) {
        let inner = Arc::new((
            Mutex::new(Inner {
                buf: VecDeque::with_capacity(cap),
                cap,
                closed: false,
            }),
            Condvar::new(), // notified when space becomes available
            Condvar::new(), // notified when an item is inserted
        ));
        (Sender { inner: inner.clone() }, Receiver { inner })
    }
}

/// Handle for sending values into the channel.
pub struct Sender<T> {
    inner: Arc<(Mutex<Inner<T>>, Condvar, Condvar)>,
}

impl<T: Send> Sender<T> {
    /// Sends a value, blocking until space is available.
    pub fn send(&self, val: T) -> Result<(), T> {
        let (lock, space_cv, item_cv) = &*self.inner;
        // Acquire the lock before inspecting the buffer state.
        let mut guard = lock.lock().unwrap();
        loop {
            if guard.closed {
                return Err(val);
            }
            if guard.buf.len() < guard.cap {
                break;
            }
            // Buffer full — park here until a receiver wakes us.
            guard = space_cv.wait(guard).unwrap();
        }
        guard.buf.push_back(val); // append item to the back of the deque
        item_cv.notify_one();
        Ok(())
    }
}

/// Handle for receiving values from the channel.
pub struct Receiver<T> {
    inner: Arc<(Mutex<Inner<T>>, Condvar, Condvar)>,
}

impl<T: Send> Receiver<T> {
    /// Receives the next value, blocking until one is available.
    pub fn recv(&self) -> Option<T> {
        let (lock, space_cv, item_cv) = &*self.inner;
        let mut guard = lock.lock().unwrap();
        // Keep waiting as long as the buffer is empty and the channel is open.
        while guard.buf.is_empty() && !guard.closed {
            guard = item_cv.wait(guard).unwrap();
        }
        let val = guard.buf.pop_front();
        if val.is_some() {
            space_cv.notify_one();
        }
        val
    }

    /// Returns the number of items currently buffered.
    pub fn len(&self) -> usize {
        let (lock, _, _) = &*self.inner;
        lock.lock().unwrap().buf.len() // snapshot under lock
    }
}

/// Wraps `recv` in a thread and returns a [`std::thread::JoinHandle`].
pub fn spawn_receiver<T: Send + 'static>(rx: Receiver<T>) -> thread::JoinHandle<Vec<T>> {
    // Drain the channel in a background thread; collect every received item.
    thread::spawn(move || {
        let mut items = Vec::new();
        while let Some(v) = rx.recv() {
            items.push(v);
        }
        items
    })
}

/* block comment mid-expression: used to annotate the capacity expression */
fn default_channel<T: Send + 'static>() -> (Sender<T>, Receiver<T>) {
    BoundedChannel::new(/* default cap */ DEFAULT_CAPACITY)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verifies that a full channel blocks the sender until a receiver drains it.
    #[test]
    fn backpressure_unblocks_on_recv() {
        // Channel with capacity 1 so the second send must block.
        let (tx, rx) = BoundedChannel::<u32>::new(1);
        tx.send(1).unwrap();
        // Spawn a receiver thread before the second send to avoid deadlock.
        let handle = spawn_receiver(rx);
        tx.send(2).unwrap();
        // Signal closure by dropping the last sender.
        drop(tx);
        let collected = handle.join().unwrap();
        assert_eq!(collected.len(), 2); // both items must be collected
    }
}
