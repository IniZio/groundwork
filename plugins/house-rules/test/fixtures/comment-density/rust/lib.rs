//! Inner doc comment for the module — describes the whole library.
//! This module provides a simple task queue with priority support.

/// A priority level for tasks in the queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    /// Lowest priority — background work.
    Low,
    /// Medium priority — default for most tasks.
    Medium,
    /// Highest priority — run before anything else.
    High,
}

/*! Inner doc block comment: this section covers the Task struct. */

/**
 * A unit of work that can be scheduled in the TaskQueue.
 *
 * Each task carries a label, a priority, and a payload.
 */
pub struct Task {
    pub label: String,
    pub priority: Priority,
    pub payload: Vec<u8>,
}

impl Task {
    /* Constructor — builds a new Task with the given fields. */
    pub fn new(label: impl Into<String>, priority: Priority, payload: Vec<u8>) -> Self {
        Task {
            label: label.into(),
            priority,
            payload,
        }
    }

    // Returns true if the task has no payload bytes.
    pub fn is_empty(&self) -> bool {
        self.payload.is_empty()
    }
}

/// A simple priority queue for [`Task`] items.
pub struct TaskQueue {
    tasks: Vec<Task>,
}

impl TaskQueue {
    /// Creates an empty [`TaskQueue`].
    pub fn new() -> Self {
        TaskQueue { tasks: Vec::new() }
    }

    /// Pushes a task onto the queue and re-sorts by priority (descending).
    pub fn push(&mut self, task: Task) {
        self.tasks.push(task);
        // Keep highest priority at the front.
        self.tasks.sort_by(|a, b| b.priority.cmp(&a.priority));
    }

    /// Pops the highest-priority task from the queue.
    pub fn pop(&mut self) -> Option<Task> {
        if self.tasks.is_empty() {
            return None;
        }
        Some(self.tasks.remove(0))
    }

    /// Returns the number of tasks currently in the queue.
    pub fn len(&self) -> usize {
        self.tasks.len()
    }
}

// This string contains fake comment syntax — NOT a real comment:
fn strings_are_not_comments() {
    let s = "url: http://example.com/path?q=1 /* not a comment */";
    let r = r#"raw string with // fake line comment inside"#;
    // A real line comment here.
    /* A real block comment here. */
    println!("{} {}", s, r);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_pop_by_priority() {
        let mut q = TaskQueue::new();
        q.push(Task::new("low-task", Priority::Low, vec![]));
        q.push(Task::new("high-task", Priority::High, vec![1, 2, 3]));
        q.push(Task::new("mid-task", Priority::Medium, vec![9]));
        // Pop order must be: High, Medium, Low.
        assert_eq!(q.pop().unwrap().label, "high-task");
        assert_eq!(q.pop().unwrap().label, "mid-task");
        assert_eq!(q.pop().unwrap().label, "low-task");
        assert!(q.pop().is_none());
    }
}
