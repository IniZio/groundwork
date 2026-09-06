// real comment
const html = `
  <div>
    <!-- html comment inside template literal, not a JS comment -->
    ${
      // nested JS comment in expression
      "value"
    }
  </div>
`;
const x = 1;
const y = 2;
