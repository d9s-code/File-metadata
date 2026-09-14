Placeholder — drop the real target `.xsd` here once it's provided.

Once present, wire schema validation into `serializer.py` via
`lxml.etree.XMLSchema`, validating the generated document before it's
returned from the export endpoint. Until then, `field_mapping.py` uses
placeholder tag names and no schema validation runs.
