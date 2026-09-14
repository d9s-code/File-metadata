# PRS Format Export Technical Specification

## 1. Overview
This specification defines the requirements for exporting Platform and MDF data into the Passive RF sensor (PRS) format. The output must be a ZIP archive containing a specific directory structure and XML files that adhere to the PRS schema.

**IMPORTANT**: The raw source elements/data must NOT be included in the export. The export should only contain the processed/committed XML structures.

## 2. Output Package Structure (ZIP)
The exported ZIP file must contain the following hierarchy:
```
/
├── dwells/
│   └── [dwell_strategy_name].xml
├── emitters/
│   └── [emitter_name].xml
├── platforms/
│   └── [platform_name].xml
└── [mdf_name].xml (Root MDF file)
```

## 3. XML Schema Mapping

### 3.1. MDF Root (`[mdf_name].xml`)
The root file links the library to a specific MDF ID.
- **Root Element**: `<ThreatLibrary xmlns="urn:com:bae:prs:pfm:library">`
- **DefaultUnknown**: `<DefaultUnknown>platforms\default_unknown_platform.xml</DefaultUnknown>`
- **MDF Entry**: `<MDF Id="{uuid}"><Name>{name}</Name></MDF>`

### 3.2. Emitter (`emitters/[emitter_name].xml`)
Maps an Emitter and its Modes.
- **Root Element**: `<Emitter Name="{emitter_name}">`
- **Metadata**: 
    - `<ELNOT>{elnot}</ELNOT>` (Fallback to empty if not available)
    - `<OwnShip Flag="{bool}" />`
    - `<LethalCeiling Value="{val}" Units="{unit}" />`
- **EWParameters**: Groups of parameters linked to Scans.
    - `<EWParameters SetId="{id}">`
    - Includes: `ThreatPriority`, `LethalPower`, `MinERP`, `MaxERP`, `Ageout`.
- **Scans**: 
    - `<Scan Name="{name}">`
    - `<Class>{class}</Class>`
    - `<Period Min="{min}" Max="{max}" Units="s" />`
    - `<EWParametersRef SetId="{id}" />`
- **Modes**: 
    - `<Mode Name="{mode_name}">`
    - `<RangeMatch PRI="{bool}" PulseWidth="{bool}" Frequency="{bool}" />`
    - `<ConfirmationQuality Value="{val}" Units="percent" />`
    - `<ConfirmationQuantity Value="{val}" Units="count" />`
    - `<Frequency Min="{min}" Max="{max}" Units="MHz" />`
    - `<PulseWidth Min="{min}" Max="{max}" Units="us" />`
    - **PRI Block (Conditional)**:
        - `Class="Simple"`: `<SimplePRI Min="{min}" Max="{max}" Units="us" />`
        - `Class="Stagger"`: Includes `<StaggerLevels Count="{n}">` with `<Level Value="{v}" Units="us" />`
        - `Class="Xlet"`: Includes `<XletsPerGroup>`, `<GroupsPerFrame>`, `<XletGap>`.
        - `Class="CW"`: `<CW />`
    - `<ScanData Name="{scan_name}" />`

### 3.3. Dwell (`dwells/[name].xml`)
Defines the dwell strategy.
- **Root Element**: `<DwellStrategies>`
- **Settings**: `<Settings timeout="{v}" setup_time="{v}" />`
- **Strategy**: `<Strategy manual_collect_time="{v}">`
- **Dwell Entries**: `<Dwell collect_time="{v}" dwell_time="{v}"><Freq value="{v}" /></Dwell>`

## 4. Implementation Requirements

### 4.1. Backend (FastAPI)
- **Service**: `prs_exporter_service.py`
- **Responsibility**:
    1. Fetch all necessary data from DB (Platform $\rightarrow$ Emitters $\rightarrow$ Modes $\rightarrow$ Parameters).
    2. Construct XML trees using `lxml`.
    3. Handle units conversion and rounding if necessary.
    4. Generate the ZIP file in memory using `io.BytesIO`.
    5. **Ensure no raw source data or temporary files are leaked into the archive.**
- **Endpoint**: `POST /platforms/{id}/export/prs` and `POST /mdfs/{id}/export/prs`

### 4.2. Frontend (React)
- **API**: `prs_export.ts`
- **UI**: "Export to PRS" button in Platform and MDF management views.
- **UX**: Show a loading spinner during generation and trigger a browser download for the `.zip` file.
