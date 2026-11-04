"""Fixtures for the sync tests: the standalone app's "PC" (see sync_support)."""

import pytest

from tests.integration.sync_support import PC, drop_pc_schemas, make_pc_schemas


@pytest.fixture(scope="module")
def pc_schemas():
    main, engines = make_pc_schemas()
    yield engines
    drop_pc_schemas(main, engines)


@pytest.fixture()
def pc(pc_schemas, db_session):
    yield PC(pc_schemas)
