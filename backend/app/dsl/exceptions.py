class DslSyntaxError(Exception):
    def __init__(self, message: str, line: int | None = None, column: int | None = None):
        self.message = message
        self.line = line
        self.column = column
        location = f" (line {line}, column {column})" if line is not None else ""
        super().__init__(f"{message}{location}")
