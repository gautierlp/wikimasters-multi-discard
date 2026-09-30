import typer

app = typer.Typer(help="WikiMasters from the terminal.", no_args_is_help=True)


@app.callback()
def _root() -> None:
    """WikiMasters from the terminal."""
