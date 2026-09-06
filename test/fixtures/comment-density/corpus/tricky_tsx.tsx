import React from 'react';
// component definition
function MyComponent({ name }: { name: string }) {
  return (
    <div>
      {/* JSX comment — should count */}
      <span>{name}</span>
      {/* another JSX comment */}
    </div>
  );
}
// trailing comment
export default MyComponent;
