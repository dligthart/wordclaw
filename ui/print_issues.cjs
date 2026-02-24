const fs = require('fs');
const issues = JSON.parse(fs.readFileSync('filtered_ui_issues.json', 'utf8'));

for (const issue of issues) {
    console.log(`\n============================`);
    console.log(`Issue #${issue.number}: ${issue.title}`);
    console.log(`============================`);
    console.log(issue.body.substring(0, 500) + (issue.body.length > 500 ? "..." : ""));
}
