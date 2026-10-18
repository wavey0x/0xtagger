"""The one command: where it finds the book, what may write to it, and the
refusal to let an outage read as an answer."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

import oxtagger_cli as cli

ADDRESS = '0x' + 'ab' * 20
OTHER = '0x' + 'cd' * 20
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


def test_an_invalid_port_does_not_repeat_what_was_configured(capsys):
    """Python names the offending port in its own message, so the refusal must
    not pass that message along."""
    secret = 'test-only-sentinel'
    configure(book_url=f'https://host:{secret}/0xtagger')
    with pytest.raises(SystemExit) as refused:
        cli.lookup([ADDRESS])
    assert secret not in str(refused.value)
    assert secret not in capsys.readouterr().err


def test_a_record_naming_no_address_or_scope_is_not_readable():
    """A junk address would print as a short form of junk under --find."""
    assert not cli.readable({'address': 'not-an-address', 'scope': 'global', 'tags': ['X']})
    assert not cli.readable({'address': ADDRESS, 'scope': 'nonsense', 'tags': ['X']})
    assert cli.readable({'address': ADDRESS, 'scope': 'eip155:8453', 'tags': ['X']})
    # What the reader has no business judging.
    assert cli.readable({'address': ADDRESS, 'scope': 'global', 'tags': ['x' * 200]})
    assert cli.readable({'address': ADDRESS, 'scope': 'global', 'tags': ['X'],
                         'source': 'some:future-source'})


def test_a_snapshot_it_can_read_is_reported(served, capsys):
    configure(book_url=served({'records': [
        {'address': ADDRESS, 'scope': 'global', 'tags': ['Treasury']}]}))
    assert cli.lookup([ADDRESS]) == 0
    assert 'Treasury' in capsys.readouterr().out


def test_a_url_that_cannot_be_parsed_is_a_misconfiguration_not_an_outage():
    """Reported as bad configuration, exit 1, rather than left to fail later as
    an unreachable book — and never with a traceback."""
    secret = 'test-only-not-a-real-key'
    for raw in ['https://host:notaport/0xtagger', 'https://host:99999/0xtagger',
                f'https://[oops/0xtagger#key={secret}']:
        configure(book_url=raw)
        with pytest.raises(cli.Unconfigured) as refused:
            cli.book_url()
        assert secret not in str(refused.value)
        with pytest.raises(SystemExit) as exit_code:
            cli.lookup([ADDRESS])
        assert exit_code.value.code != 2


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


# ---------------------------------------------------------------------------
# add
# ---------------------------------------------------------------------------

@pytest.fixture
def book(monkeypatch, tmp_path):
    """The real app, reached the way the command reaches it, counting requests
    and keeping every header the command chose to send."""
    from fastapi.testclient import TestClient
    from server import create_app

    client = TestClient(create_app(tmp_path / 'book.sqlite3', TOKEN))
    sent = []

    def request(url, *, method='GET', token=None, body=None):
        headers = {'Authorization': f'Bearer {token}'} if token else {}
        sent.append((method, headers))
        from urllib.parse import urlsplit as split
        answer = client.request(method, split(url).path, headers=headers, json=body)
        return answer.status_code, answer.json()

    monkeypatch.setattr(cli, 'request', request)
    configure(book_url='http://127.0.0.1:8712')
    keep_token()
    client.sent = sent
    return client


def held(book):
    answer = book.get('/tags', headers={'Authorization': f'Bearer {TOKEN}'})
    return {(r['address'], r['scope']): r for r in answer.json()['records']}


def writes(book):
    return [method for method, _ in book.sent].count('PUT')


def test_add_requires_exactly_one_scope():
    for argv in [[f'{ADDRESS}=Treasury'],
                 ['--chain', '1', '--global', f'{ADDRESS}=Treasury']]:
        with pytest.raises(SystemExit) as refused:
            cli.add(argv)
        assert refused.value.code == 2  # argparse usage error


def test_add_takes_no_token_argument():
    with pytest.raises(SystemExit):
        cli.add(['--chain', '1', '--token', TOKEN, f'{ADDRESS}=Treasury'])


def test_add_checks_every_name_before_sending_anything(book):
    for wrong in ['0xnope=Treasury', f'{ADDRESS}=', f'{ADDRESS}={"x" * 81}',
                  f'{ADDRESS}=bad\x07tag']:
        with pytest.raises(SystemExit):
            cli.add(['--chain', '1', wrong])
    with pytest.raises(SystemExit) as refused:
        cli.add(['--chain', '1', f'{ADDRESS}=One', f'{ADDRESS}=Two'])
    assert 'named twice' in str(refused.value)
    # Nothing was sent on the way to any of those refusals.
    assert writes(book) == 0


def test_a_hash_is_a_comment_only_at_the_start_of_a_line(book):
    """`Curve DAO #1` is a name. Writing half of it would be worse than
    refusing the line."""
    assert cli.add(['--chain', '1', f'{ADDRESS}=DA0 #1',
                    f'{OTHER}  Vault #2 (old)', '# a whole-line comment', '']) == 0
    assert {key: record['tags'] for key, record in held(book).items()} == {
        (ADDRESS, 'eip155:1'): ['DA0 #1'],
        (OTHER, 'eip155:1'): ['Vault #2 (old)']}


def test_a_conflict_list_this_batch_did_not_ask_for_is_not_filtered_by(book, monkeypatch, capsys):
    """A 409 naming an address we never sent would otherwise drop the wrong
    change and report a stranger's name as kept."""
    foreign = '0x' + 'ef' * 20
    answers = [
        (409, {'conflicts': [{'address': foreign, 'scope': 'eip155:1',
                              'current': {'address': foreign, 'scope': 'eip155:1',
                                          'tags': ['Someone Else']}}]}),
        (409, {'conflicts': [{'address': ADDRESS, 'scope': 'eip155:1', 'current': None}]}),
        (409, {'conflicts': 'not a list'}),
        (409, {}),
    ]
    for answer in answers:
        sent = []
        monkeypatch.setattr(cli, 'request',
                            lambda *a, _answer=answer, **k: (sent.append(1), _answer)[1])
        assert cli.add(['--chain', '1', f'{ADDRESS}=Mine']) == 2
        printed = capsys.readouterr()
        assert 'nothing was written' in printed.err
        assert printed.out == ''
        # Refused, not retried.
        assert len(sent) == 1


def test_add_reads_either_form_and_collapses_an_exact_duplicate(book):
    assert cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault',
                    f'{ADDRESS}=Balancer Vault', f'{OTHER}  Payroll']) == 0
    assert {key: record['tags'] for key, record in held(book).items()} == {
        (ADDRESS, 'eip155:1'): ['Balancer Vault'],
        (OTHER, 'eip155:1'): ['Payroll']}
    assert writes(book) == 1


def test_add_creates_a_chain_record_labelled_as_an_investigation(book, capsys):
    assert cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault']) == 0
    record = held(book)[(ADDRESS, 'eip155:1')]
    assert record['tags'] == ['Balancer Vault']
    assert record['source'] == 'agent:investigation'
    assert 'added' in capsys.readouterr().out


def test_add_creates_only_global_records_when_asked(book):
    assert cli.add(['--global', f'{ADDRESS}=Known entity wallet']) == 0
    assert list(held(book)) == [(ADDRESS, 'global')]
    # The server consults only_if_unnamed for a narrower scope than global, so
    # a global change does not carry a flag that would do nothing.
    assert cli.changes_from([f'{ADDRESS}=X'], 'global') == [
        {'address': ADDRESS, 'scope': 'global', 'tags': ['X'],
         'version': None, 'source': 'agent:investigation'}]


def test_add_never_replaces_a_name_the_book_holds(book, capsys):
    cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault'])
    book.sent.clear()
    assert cli.add(['--chain', '1', f'{ADDRESS}=Something Else']) == 0
    assert held(book)[(ADDRESS, 'eip155:1')]['tags'] == ['Balancer Vault']
    assert 'kept' in capsys.readouterr().out
    # Every candidate conflicted, so there was nothing to retry.
    assert writes(book) == 1


def test_an_all_networks_name_covers_a_chain_add(book):
    cli.add(['--global', f'{ADDRESS}=Mine'])
    book.sent.clear()
    assert cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault']) == 0
    assert list(held(book)) == [(ADDRESS, 'global')]
    assert writes(book) == 1


def test_a_chain_name_keeps_precedence_when_a_global_one_is_added(book):
    cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault'])
    assert cli.add(['--global', f'{ADDRESS}=Known entity wallet']) == 0
    records = held(book)
    assert records[(ADDRESS, 'eip155:1')]['tags'] == ['Balancer Vault']
    assert records[(ADDRESS, 'global')]['tags'] == ['Known entity wallet']
    # What a lookup for that chain reports is still the chain's name.
    snapshot = list(records.values())
    assert cli.look_up(snapshot, ADDRESS, '1')[0]['label'] == 'Balancer Vault'


def test_add_sends_the_remainder_once_when_one_name_is_taken(book, capsys):
    cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault'])
    book.sent.clear()
    assert cli.add(['--chain', '1', f'{ADDRESS}=Something Else', f'{OTHER}=Payroll']) == 0
    assert {key: record['tags'] for key, record in held(book).items()} == {
        (ADDRESS, 'eip155:1'): ['Balancer Vault'],
        (OTHER, 'eip155:1'): ['Payroll']}
    printed = capsys.readouterr().out
    assert 'kept' in printed and 'added' in printed
    # The conflict, then the remainder. One retry, never a loop.
    assert writes(book) == 2


def test_a_repeat_run_changes_nothing(book):
    cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault', f'{OTHER}=Payroll'])
    before = held(book)
    assert cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault', f'{OTHER}=Payroll']) == 0
    assert held(book) == before


def test_a_reply_that_confirms_nothing_is_not_a_save(book, monkeypatch, capsys):
    """Exit 2 is never a save, and an unconfirmed write is never retried."""
    def unconfirming(url, *, method='GET', token=None, body=None):
        book.sent.append((method, {}))
        return 200, {'records': []}

    monkeypatch.setattr(cli, 'request', unconfirming)
    assert cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault']) == 2
    assert 'unknown' in capsys.readouterr().err
    assert writes(book) == 1


def test_a_lost_reply_does_not_claim_nothing_was_saved(book, monkeypatch, capsys):
    monkeypatch.setattr(cli, 'request', lambda *a, **k: (_ for _ in ()).throw(
        cli.Unavailable('electro.example could not be reached')))
    assert cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault']) == 2
    assert 'unknown' in capsys.readouterr().err


def test_add_stops_before_the_request_without_a_token(book, capsys):
    (cli.config_home() / 'token').unlink()
    with pytest.raises(SystemExit) as refused:
        cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault'])
    assert str(cli.config_home() / 'token') in str(refused.value)
    assert writes(book) == 0


def test_add_reports_a_rejected_token_without_the_secret(book, monkeypatch, capsys):
    monkeypatch.setenv('OXTAGGER_TOKEN', 'not-the-token')
    assert cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault']) == 2
    assert held(book) == {}
    printed = capsys.readouterr().err
    assert 'did not accept the token' in printed
    assert 'not-the-token' not in printed


def test_add_sends_a_bearer_header_and_never_an_origin(book):
    cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault'])
    method, headers = book.sent[-1]
    assert method == 'PUT'
    assert headers['Authorization'] == f'Bearer {TOKEN}'
    assert not any(name.lower() == 'origin' for name in headers)


def test_the_real_transport_sends_bearer_auth_and_no_origin(monkeypatch, capsys):
    """The other credential tests replace `request`; this one runs it, so the
    headers asserted here are the headers that go on the wire."""
    import json as _json
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def do_PUT(self):
            seen['headers'] = dict(self.headers)
            seen['body'] = _json.loads(
                self.rfile.read(int(self.headers['Content-Length'])))
            payload = _json.dumps({'records': seen['body']['changes']}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        configure(book_url=f'http://127.0.0.1:{httpd.server_address[1]}')
        keep_token()
        assert cli.add(['--chain', '1', f'{ADDRESS}=Balancer Vault']) == 0
    finally:
        httpd.shutdown()

    assert seen['headers']['Authorization'] == f'Bearer {TOKEN}'
    assert not any(name.lower() == 'origin' for name in seen['headers'])
    assert seen['headers']['Content-Type'] == 'application/json'
    assert seen['body']['changes'] == [{
        'address': ADDRESS, 'scope': 'eip155:1', 'tags': ['Balancer Vault'],
        'version': None, 'source': 'agent:investigation', 'only_if_unnamed': True}]
    # The token appears in no output of its own.
    printed = capsys.readouterr()
    assert TOKEN not in printed.out and TOKEN not in printed.err
