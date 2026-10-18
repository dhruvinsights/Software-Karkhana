# Copyright 2026 Software Karkhana authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""QA scripts may only call real endpoints, so the endpoint list must be right."""

from app.services.qa_synth import exercises, per_file, routes, script_problems

CUSTOMERS = '''
router = APIRouter(prefix="/customers", tags=["customers"])

@router.post("", response_model=CustomerOut)
def create(): ...

@router.get("/{customer_id}")
def get(): ...
'''
ENTRIES = 'router = APIRouter(prefix="/customers/{customer_id}/entries")\n@router.post("", status_code=201)\n'
MAIN = '@app.get("/health")\n'


def test_router_prefixes_and_empty_paths_are_joined():
    assert routes(CUSTOMERS, ENTRIES, MAIN) == {
        ("POST", "/customers"),
        ("GET", "/customers/{customer_id}"),
        ("POST", "/customers/{customer_id}/entries"),
        ("GET", "/health"),
    }


def test_a_change_adds_its_routes_file_by_file():
    patch = (
        "diff --git a/r.py b/r.py\n+++ b/r.py\n"
        '+router = APIRouter(prefix="/z")\n+@router.get("/q")\n'
        "diff --git a/m.py b/m.py\n+++ b/m.py\n"
        '+@app.post("/p")\n'
    )
    # The prefix of one file never leaks into another.
    assert routes(*per_file(patch)) == {("GET", "/z/q"), ("POST", "/p")}


def test_scripts_against_the_real_endpoint_pass_the_check():
    allowed = routes(CUSTOMERS, ENTRIES)
    good = "def test_x():\n    r = requests.post(f'{BASE_URL}/customers/7/entries', json={})\n    assert r.status_code == 404"
    assert script_problems(good, allowed) == []
    wrong = "def test_x():\n    r = requests.get(f'{BASE_URL}/999')\n    assert r.status_code == 404"
    assert script_problems(wrong, allowed)


def test_a_health_ping_does_not_test_a_scenario():
    ping = "r = requests.get(f'{BASE_URL}/health')"
    assert not exercises(ping, "Create a credit entry")
    assert exercises(ping, "Health check reports ok")
    assert exercises("requests.post(f'{BASE_URL}/customers/1/entries')", "Create a credit entry")
    assert not exercises("assert True", "Create a credit entry")
