# tdd

No production code without a failing test first.

1. **Red.** Write one small test for the next behaviour. Run it and read the output: it must fail, and for the reason you expect (missing behaviour, not a typo or import error). A test that passes at once proves nothing: fix the test.
2. **Green.** Write the least code that makes it pass. Run the tests: the new one and the rest pass, output clean.
3. **Refactor** only while green: remove duplication, improve names, no new behaviour. Run the tests again.
4. Repeat for the next behaviour.

Rules:

- Code written before its test is deleted and redone from the test, not "adapted".
- One behaviour per test, a name that says it, real code over mocks wherever feasible.
- A bug fix starts with a test that reproduces the bug and fails ([debug](debug.reference.md)).
- Edge cases and error paths get their own tests.
- Use the project's own test runner and conventions and match the style of existing tests.

Exceptions (config, generated code, throwaway prototypes) only with the user's explicit agreement.
