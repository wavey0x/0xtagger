"""The one command: where it finds the book, what may write to it, and the
refusal to let an outage read as an answer."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

import oxtagger_cli as cli

ADDRESS = '0x' + 'ab' * 20
TOKEN = 'test-only-token'
ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(autouse=True)
def elsewhere(tmp_path, monkeypatch):
    """No test may read this machine's real book, config or token."""
    monkeypatch.setenv('XDG_CONFIG_HOME', str(tmp_path / 'config'))
    monkeypatch.delenv('OXTAGGER_BOOK_URL', raising=False)
    monkeypatch.delenv('OXTAGGER_TOKEN', raising=False)


def configure(**settings):
    path = cli.config_home()
    path.mkdir(parents=True, exist_ok=True)
    (path / 'config.json').write_text(json.dumps(settings))


def keep_token(token=TOKEN, mode=0o600):
    path = cli.config_home()
    path.mkdir(parents=True, exist_ok=True)
    (path / 'token').write_text(token + '\n')
    (path / 'token').chmod(mode)
    return path / 'token'


@pytest.fixture
def served():
    """Serve one crafted snapshot on loopback and return its URL."""
    import json as _json
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    body = {'records': []}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            payload = _json.dumps(body).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    def serve(snapshot):
        body.clear()
        body.update(snapshot)
        return f'http://127.0.0.1:{httpd.server_address[1]}'

    yield serve
    httpd.shutdown()


def test_a_book_must_be_configured_and_reached_over_https():
    """No default: one person's tailnet hostname is not everyone's book."""
    with pytest.raises(SystemExit) as refused:
        cli.lookup([ADDRESS])
    assert str(cli.config_home() / 'config.json') in str(refused.value)

    configure(book_url='http://electro.example/0xtagger')
    with pytest.raises(SystemExit) as refused:
        cli.lookup([ADDRESS])
    assert 'not https' in str(refused.value)

    configure(book_url='https://electro.example/0xtagger/')
    assert cli.book_url() == 'https://electro.example/0xtagger'


def test_a_pasted_connect_link_is_not_a_book_url():
    """The extension's link carries the key in its fragment. It must be refused,
    and the refusal must not repeat what it was handed."""
    secret = 'test-only-not-a-real-key'
    for raw in [f'https://electro.example/0xtagger#key={secret}',
                f'https://name:{secret}@electro.example/0xtagger',
                f'https://electro.example/0xtagger?key={secret}']:
        configure(book_url=raw)
        with pytest.raises(cli.Unconfigured) as refused:
            cli.book_url()
        assert secret not in str(refused.value)

    configure(book_url='https:///0xtagger')
    with pytest.raises(cli.Unconfigured) as refused:
        cli.book_url()
    assert 'names no host' in str(refused.value)


def test_a_reply_this_program_cannot_read_is_not_a_book(served, capsys):
    """A record with no name would raise on the way to being printed, so a
    snapshot we do not understand is an outage, not an address without a tag."""
    for records in [[{'address': ADDRESS, 'scope': 'global', 'tags': []}],
                    [{'address': ADDRESS, 'scope': 'global'}],
                    [{'address': ADDRESS, 'scope': 'global', 'tags': [7]}],
                    [{'scope': 'global', 'tags': ['Treasury']}],
                    ['not a record']]:
        configure(book_url=served({'records': records}))
        with pytest.raises(cli.Unavailable):
            cli.records_of(cli.book_url())
        assert cli.lookup([ADDRESS]) == 2
        printed = capsys.readouterr()
        assert 'not a 0xtagger book' in printed.err
        # Not one word about the address itself.
        assert printed.out == ''


def test_a_snapshot_it_can_read_is_reported(served, capsys):
    configure(book_url=served({'records': [
        {'address': ADDRESS, 'scope': 'global', 'tags': ['Treasury']}]}))
    assert cli.lookup([ADDRESS]) == 0
    assert 'Treasury' in capsys.readouterr().out


def test_the_environment_overrides_the_configured_book(monkeypatch):
    configure(book_url='https://electro.example/0xtagger')
    monkeypatch.setenv('OXTAGGER_BOOK_URL', 'http://127.0.0.1:8712')
    assert cli.book_url() == 'http://127.0.0.1:8712'


def test_a_book_url_that_is_not_json_is_refused_clearly():
    path = cli.config_home()
    path.mkdir(parents=True, exist_ok=True)
    (path / 'config.json').write_text('{ not json')
    with pytest.raises(cli.Unconfigured) as refused:
        cli.book_url()
    assert 'not valid JSON' in str(refused.value)


def test_writing_needs_a_token_and_refuses_one_others_can_read():
    with pytest.raises(cli.Unconfigured) as refused:
        cli.write_token()
    assert str(cli.config_home() / 'token') in str(refused.value)

    path = keep_token(mode=0o644)
    with pytest.raises(cli.Unconfigured) as refused:
        cli.write_token()
    assert 'readable by others' in str(refused.value)
    # Whatever is said about the file, the secret itself is never in it.
    assert TOKEN not in str(refused.value)

    path.chmod(0o600)
    assert cli.write_token() == TOKEN


def test_an_empty_token_file_is_not_a_credential():
    keep_token(token='')
    with pytest.raises(cli.Unconfigured) as refused:
        cli.write_token()
    assert 'is empty' in str(refused.value)


def test_an_unavailable_book_is_never_an_answer(monkeypatch, capsys):
    configure(book_url='https://electro.example/0xtagger')

    def unreachable(url):
        raise cli.Unavailable('electro.example could not be reached')

    monkeypatch.setattr(cli, 'records_of', unreachable)
    assert cli.lookup([ADDRESS]) == 2
    printed = capsys.readouterr()
    assert 'unavailable' in printed.err
    # Not one word about the address itself.
    assert printed.out == ''


def test_an_unavailable_book_carries_no_results_key(monkeypatch, capsys):
    configure(book_url='https://electro.example/0xtagger')

    def unreachable(url):
        raise cli.Unavailable('electro.example could not be reached')

    monkeypatch.setattr(cli, 'records_of', unreachable)
    assert cli.lookup([ADDRESS, '--json']) == 2
    assert 'results' not in json.loads(capsys.readouterr().out)


def test_a_name_on_another_chain_is_an_aside_not_an_answer():
    records = [{'address': ADDRESS, 'scope': 'eip155:8453', 'tags': ['Payroll']}]
    rows = cli.look_up(records, ADDRESS, '1')
    assert rows == [{'address': ADDRESS, 'found': False, 'elsewhere': ['Base']}]


def test_only_serve_pays_for_the_web_framework():
    """A lookup is the frequent operation; it must not import a web framework."""
    answer = subprocess.run(
        [sys.executable, '-c',
         'import oxtagger_cli, sys; print(bool({"fastapi", "uvicorn"} & set(sys.modules)))'],
        capture_output=True, text=True, cwd=ROOT, check=True)
    assert answer.stdout.strip() == 'False'
