# Contributing to TDS RapidInt

Thank you for contributing to the TDS RapidInt integration platform!

## Development Workflow

### 1. Fork and Clone
```bash
git clone https://github.com/OLODHI-TDS/RapidInt.git
cd RapidInt
```

### 2. Create Feature Branch
```bash
git checkout -b feature/your-feature-name
```

### 3. Make Changes
- Follow existing code style
- Add comments for complex logic
- Update documentation if needed

### 4. Test Locally
```bash
cd azure-functions
npm install
npm start
```

### 5. Commit Changes
```bash
git add .
git commit -m "feat: Add new feature description"
```

### 6. Push and Create Pull Request
```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## Commit Message Convention

Follow conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance tasks

Examples:
```
feat: Add webhook signature validation
fix: Correct tenant data mapping for Alto
docs: Update deployment guide
refactor: Simplify TDS adapter factory
```

## Code Style

- Use **2 spaces** for indentation
- Use **camelCase** for variables and functions
- Use **PascalCase** for classes
- Add **JSDoc comments** for functions
- Keep functions small and focused

## Testing

Before submitting a PR:
1. Test locally with `func start`
2. Verify all endpoints work
3. Check logs for errors
4. Test edge cases

## Pull Request Process

1. Update README.md if needed
2. Ensure all tests pass
3. Request review from maintainers
4. Address review comments
5. Squash commits if needed

## Questions?

Open an issue or contact the maintainers.
