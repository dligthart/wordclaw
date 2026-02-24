# RFC 0010: Supervisor UI Usability and Accessibility Hardening

**Author:** AI Assistant  
**Status:** Partially Implemented  
**Date:** 2026-02-21  

## 1. Summary
This RFC proposes a focused usability and accessibility hardening program for the WordClaw Supervisor UI. It introduces a responsive app shell, a consistent feedback model (toasts, confirmations, non-blocking errors), reusable data-view components, and keyboard-accessible interaction standards across all operational pages.

## 2. Dependencies & Graph
* **Depends on:** RFC 0007 (Policy-Driven Editorial Workflow) for approval/review decision semantics.
* **Depends on:** RFC 0008 (Policy Parity) for consistent remediation/error contracts surfaced in the UI.
* **Depended on by:** Future supervisor productivity features (bulk moderation, payout operations, distribution operations).

## 3. Motivation
Current Supervisor UI functionality is broad, but usability is constrained by structural issues:
* fixed multi-column layouts (`w-1/4`, `w-1/3`, `w-1/2`) degrade significantly on narrow viewports,
* critical actions rely on browser `alert()` or immediate execution instead of safe in-app confirmations,
* error handling is page-local and drops actionable remediation metadata from API responses,
* interaction and table patterns are inconsistent across pages.

These gaps increase operator error risk and reduce throughput for high-volume agent operations.

## 4. Proposal
Introduce four UI primitives and migrate all pages to use them:
1. **Responsive Shell**: Collapsible sidebar + mobile drawer with preserved route context.
2. **Feedback Framework**: Standard toast notifications, inline error surfaces, and confirm dialogs for destructive actions.
3. **Reusable Data Patterns**: Shared `DataTable`, `EmptyState`, `LoadingState`, and `SplitPane` components.
4. **Accessibility Baseline**: Keyboard operability, focus states, and semantic action controls for all interactive elements.

## 5. Technical Design (Architecture)

### 5.1 Responsive App Shell
* Replace fixed desktop sidebar assumptions with breakpoint-aware shell behavior:
  * desktop: persistent left nav,
  * tablet/mobile: off-canvas nav with explicit open/close controls and focus trap.
* Preserve current route activation state and add breadcrumb context per page.
* Normalize page padding and max-width containers for readability at large resolutions.

### 5.2 Unified Feedback and Action Safety
* Add `ui/src/lib/ui-feedback.svelte.ts` store:
  * `pushToast({ severity, title, message, action? })`
  * `openConfirm({ title, message, confirmLabel, confirmIntent })`
* Replace `alert()` usage with non-blocking toast/inline patterns.
* Require guarded confirmations for destructive/irreversible actions:
  * approval reject/publish,
  * content rollback,
  * API key revoke/rotate.
* Integrate API remediation fields (`code`, `remediation`, `meta`) into error panels instead of reducing to `message`.

### 5.3 Page-Level Workflow Improvements
* **Approval Queue**:
  * add reason capture (`approve`, `reject`, `escalate`) aligned with RFC 0007 decisions,
  * add next-item shortcuts to reduce queue handling latency.
* **Content Browser**:
  * show rollback diff preview and require confirmation before apply,
  * separate current data and historical snapshots with clearer visual hierarchy.
* **Schema Manager**:
  * persist editor draft state per model,
  * use structured validation feedback (field path + reason) rather than raw error strings.
* **Payments/Audit Logs/Keys**:
  * standardize filtering, pagination controls, and row expansion interaction.

### 5.4 Accessibility and Interaction Contracts
* Replace clickable non-interactive elements (`tr` click targets) with explicit buttons/links.
* Enforce keyboard and assistive behavior:
  * tab order,
  * `aria-*` labels for dialogs and status regions,
  * visible focus outlines.
* Add accessibility test coverage for core flows (login, approval decision, key management, payment inspection).

### 5.5 Telemetry for Usability Outcomes
* Emit UI metrics to measure impact:
  * time-to-decision in approval queue,
  * action error rate per page,
  * confirmation cancel rate,
  * mobile session completion rate.

## 6. Alternatives Considered
* **Local page-by-page patching only:** Faster initially but preserves inconsistency and duplicated logic.
* **Complete UI rewrite:** Higher risk and slower delivery than incremental hardening with shared primitives.
* **Backend-only improvements:** Necessary but insufficient; operator friction remains high without UI interaction fixes.

## 7. Security & Privacy Implications
* Confirmation dialogs reduce accidental high-impact mutations.
* UI feedback must avoid exposing sensitive payload content in toasts or browser clipboard flows.
* Error panels should redact sensitive fields while preserving remediation guidance from policy and API layers.

## 8. Rollout Plan / Milestones
1. **Phase 1:** Add shared feedback primitives (toast, confirm dialog, inline error component) and wire into keys/content/approvals pages.
2. **Phase 2:** Implement responsive shell and mobile-safe navigation behavior.
3. **Phase 3:** Replace page-local table/list states with shared `DataTable` + standard pagination/filter contracts.
4. **Phase 4:** Implement approval and rollback safety flows (reason capture + confirmation + post-action navigation shortcuts).
5. **Phase 5:** Add accessibility checks in CI and collect baseline-to-post metrics for operator efficiency.

## 9. Success Criteria
* 0 direct `alert()` calls in production UI code paths.
* All destructive mutations require explicit confirmation.
* All main pages remain fully operable at mobile viewport widths (>= 360px).
* Keyboard-only completion of login, approval, key revoke, and rollback flows.
* At least 30% reduction in failed supervisor mutations after rollout.

---

## Review Comments

> **Reviewer:** Claude (Opus 4.6)
> **Date:** 2026-02-21

### Strengths
- Well-motivated by real codebase issues. I verified the current UI state: there are exactly 3 `alert()` calls (approvals:90, content:93, content:95), the sidebar is a fixed `w-64` with no mobile breakpoint, only 4 `aria-*` attributes exist across the entire frontend, and multi-panel layouts (`w-1/4`, `w-1/3`) have no responsive adaptation.
- The four-primitive approach (shell, feedback, data patterns, accessibility) is the right decomposition — these are reusable foundations, not page-specific patches.
- The Success Criteria section (Section 9) is concrete and measurable, which is rare for UI RFCs. "0 direct `alert()` calls" and "keyboard-only completion of login, approval, key revoke, and rollback flows" are testable assertions.
- Dependency graph correctly identifies RFC 0007 (approval decision semantics) and RFC 0008 (remediation contracts) as upstream dependencies.

### Suggested Improvements

1. **The feedback store API needs error categorization from RFC 0008.** The proposed `pushToast({ severity, title, message, action? })` is a good start, but RFC 0008's `PolicyDecision` returns structured `{ code, remediation, metadata }`. The toast/error component should accept and render these fields directly rather than flattening to a `message` string. Sketch a richer interface:
   ```typescript
   interface FeedbackPayload {
     severity: 'success' | 'warning' | 'error' | 'info';
     title: string;
     message?: string;
     code?: string;           // from PolicyDecision.code
     remediation?: string;    // from PolicyDecision.remediation
     action?: { label: string; handler: () => void };
     autoDismissMs?: number;  // default 5000 for success, sticky for errors
   }
   ```

2. **The `fetchApi` wrapper needs upgrading in tandem.** The current `ui/src/lib/api.ts` throws `new Error(data?.error || data?.message || 'API request failed')`, discarding the structured `code`, `remediation`, and `meta` fields from API responses. This RFC should explicitly include refactoring `fetchApi` to preserve and surface these fields, otherwise the new feedback framework has nothing structured to display. Consider a custom error class:
   ```typescript
   class ApiError extends Error {
     code: string;
     remediation?: string;
     meta?: Record<string, unknown>;
   }
   ```

3. **Confirm dialog needs to support async actions with loading state.** The proposed `openConfirm({ title, message, confirmLabel, confirmIntent })` is synchronous UX, but the destructive actions it guards (rollback, key revocation) are async API calls that can take seconds. The confirm dialog should support a "confirming..." loading state on the confirm button to prevent double-clicks and provide feedback. The keys page already has an inline confirmation pattern (`confirmRevokeId`) — document how this migrates to the shared component.

4. **Missing: dark mode audit for new components.** The existing UI has comprehensive `dark:` variant coverage. The RFC doesn't mention dark mode for the new primitives (toast, confirm dialog, DataTable). Since these are shared components, explicitly require dark mode support in the spec to prevent regression.

5. **Missing: DataTable column specification.** The RFC proposes a shared `DataTable` component but doesn't specify its interface. Current tables across pages have different column structures, sorting, expansion behavior, and click handling. Define at minimum:
   - Column definition API (key, label, sortable, width, render function).
   - Row expansion slot/callback pattern.
   - Selection model (if needed for future bulk operations).
   - Pagination integration (cursor vs. offset — the codebase uses both).

6. **Missing: offline/degraded state handling.** The current UI has no handling for network failures mid-session. If the API goes down while a supervisor is reviewing the approval queue, the UI fails silently or shows generic errors. Consider adding a connection status indicator in the app shell (building on the existing `/health` endpoint) with a reconnection banner.

7. **Telemetry implementation needs privacy specification.** Section 5.5 proposes emitting metrics like "time-to-decision in approval queue" and "mobile session completion rate." These could be considered user behavior tracking. Specify:
   - Where metrics are stored (server-side aggregate only? No third-party analytics?).
   - Whether telemetry is opt-in or opt-out.
   - That no PII is included in metric payloads.
   This is especially important given the Security section's own point about not exposing sensitive content.

8. **Phase ordering should front-load the highest-impact items.** The current phasing puts the responsive shell in Phase 2, but the 3 `alert()` calls and missing confirmations (Phase 1) are lower risk than the multi-panel layout breakage on mobile. Consider whether supervisors on tablets (a realistic scenario for on-the-go approvals) would benefit more from responsive shell work earlier. Alternatively, if desktop is the primary target, document that assumption explicitly.

9. **Consider: WCAG compliance level target.** The RFC mentions keyboard operability and focus states but doesn't declare a target WCAG level (A, AA, or AAA). For an internal operational tool, WCAG 2.1 AA is a reasonable and defensible target. Declaring it gives the accessibility test coverage (Phase 5) a clear pass/fail benchmark.
