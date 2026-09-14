# Test Plan: RF Emitter Profile Manager

## 1. Introduction
This document outlines the testing strategy and specific test cases for the RF Emitter Profile Manager. The goal is to ensure data integrity, functional correctness of the hierarchical pinning model, and reliability of the analytical tools (Ambiguity Checks) and export functionality.

## 2. Test Strategy

### 2.1 Manual Testing
- **Exploratory Testing**: Testers should explore new features (like the PRS Export) following natural workflows.
- **UI/UX Verification**: Ensuring responsive design, correct color coding (status badges, ambiguity severity), and intuitive navigation.

### 2.2 Automated Testing
- **Unit Tests (Backend)**: Testing individual logic components (DSL parser, PRS serializer, ambiguity math).
- **Integration Tests (Backend)**: Testing the interaction between API endpoints and the database (e.g., Emitter $\rightarrow$ Source $\rightarrow$ Mode flow).
- **End-to-End (E2E) Tests**: Simulating user workflows from login to MDF creation and XML export.

## 3. Functional Test Suites

### 3.1 Emitter Management
- [ ] **DSL Parser**: Verify all valid DSL strings (Fixed, Stagger, CW) parse correctly. Verify invalid syntax returns helpful errors.
- [ ] **Cartesian Product**: Generate modes from RF/PW/PRI elements and verify the resulting Mode Lines match expected combinations.
- [ ] **Elements Pool**: Verify that typing a DSL line correctly populates the Source's Elements panel.
- [ ] **EW Grouping**: Ensure Modes can be moved between EW Groups without losing parameter data.

### 3.2 Platform & Pinning Model (Critical)
- [ ] **Emitter Version Pinning**: Create a Platform pinned to Emitter v1. Edit Emitter to v2. Verify Platform still reflects v1 data.
- [ ] **Platform Repinning**: Explicitly re-pin a Platform to a new Emitter version and verify the update.
- [ ] **MDF Pinning**: Create an MDF pinned to Platform v1. Verify that updates to Platform v2 do not affect the MDF.

### 3.3 Mission Data Files (MDF) & Status Lifecycle
- [ ] **Status Transitions**: Verify legal transitions (e.g., `draft` $\rightarrow$ `in_review` $\rightarrow$ `validated`). Attempt illegal transitions and verify they are blocked.
- [ ] **Readiness Signals**: 
    - Verify warnings appear if an MDF references unvalidated Emitters.
    - Verify warnings appear if an MDF has no passing Test Records.
- [ ] **Version Commits**: Ensure every status transition triggers a new version snapshot.

### 3.4 PRS XML Export
- [ ] **Hierarchy Integrity**: Verify exported XML correctly traverses Platforms $\rightarrow$ Emitters $\rightarrow$ Modes.
- [ ] **Data Accuracy**: Verify engineered values (raw $\pm$ delta) are exported, not raw values.
- [ ] **Sanitization**: Attempt to name an Emitter with XML-breaking characters (e.g., `<`, `>`, `&`) and verify the export remains valid.
- [ ] **PRI/ELNOT Accuracy**: Verify `PRI` class attributes and `ELNOT` designation fields are correctly represented.

### 3.5 Ambiguity Checks
- [ ] **Overlap Detection**: Test edge cases of RF, PW, and PRI overlaps (exact match, partial overlap, no overlap).
- [ ] **PRI Type Logic**: Verify ambiguity calculation correctly handles Fixed vs. Stagger and CW types.
- [ ] **Scope Verification**: Run checks at Per-Emitter, Per-Platform, and Per-MDF levels and verify results are scoped correctly.

### 3.6 Test Tracking
- [ ] **Test Linking**: Link a Mode to a Test Record and verify the "Test-Derived" badge appears.
- [ ] **MDF Readiness**: Ensure a passing Test Record correctly satisfies the MDF readiness signal.

## 4. Non-Functional Testing

### 4.1 Security
- [ ] **Role-Based Access Control (RBAC)**: Verify Viewers cannot edit Modes or trigger commits. Verify Admins can access the Admin Panel.
- [ ] **Authentication**: Verify session expiration and protection against unauthorized API access via CSRF.

### 4.2 Robustness & Data Integrity
- [ ] **Concurrency**: Simulate multiple users editing different Emitters simultaneously to check for race conditions.
- [ ] **Database Recovery**: Test the Restore/Backup scripts to ensure data can be recovered from `pg_dump` snapshots.

## 5. Critical Failure Points & Risk Analysis

| Feature | Potential Failure Point | Impact | Mitigation |
|---|---|---|---|
| **Pinning Model** | Mismatch between pinned version and active draft | High | Strict versioning; explicit "repinning" required for changes to propagate. |
| **Ambiguity Math** | Floating point errors in overlap calculations | Medium | Use high-precision decimals or epsilon-based comparisons. |
| **XML Export** | Special characters in metadata breaking hardware loaders | High | Rigorous string sanitization in the serializer. |
| **Data Import** | Malformed JSON causing partial/corrupt imports | Medium | Implement dry-run `/validate` endpoint before committing imports. |
| **Status Transitions** | Bypassing validation steps via direct API calls | High | Backend-enforced state machine logic. |

## 6. Environment & Setup
- **Database**: PostgreSQL (required for production/dev parity).
- **Backend**: Python 3.12+ with FastAPI.
- **Frontend**: Node.js + Vite + React.
- **Test Data**: Use the provided reference XML files for cross-verification of the PRS export.
