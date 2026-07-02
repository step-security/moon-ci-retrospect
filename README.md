[![StepSecurity Maintained Action](https://raw.githubusercontent.com/step-security/maintained-actions-assets/main/assets/maintained-action-banner.png)](https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions)

# step-security/moon-ci-retrospect

Collects and displays moon ci and moon run results as a readable GitHub Actions job summary.

This action is designed for projects using [Moonrepo](https://moonrepo.dev). Running `moon ci` or `moon run` executes numerous tasks in parallel, which makes it difficult to view logs per task and pinpoint CI failures. This action reads the moon cache report and generates a structured job summary so failures are easy to identify.

## Usage

```yaml
jobs:
  ci:
    name: "CI"
    runs-on: "ubuntu-latest"
    steps:
      - name: "Checkout"
        uses: "actions/checkout@v7"
        with:
          fetch-depth: 0

      - name: "Setup Toolchain"
        uses: "moonrepo/setup-toolchain@v0"

      - name: "Run CI pipeline"
        run: "moon ci"

      - name: "Collect and display moon CI results"
        uses: "step-security/moon-ci-retrospect@v2"
        if: success() || failure()
```
