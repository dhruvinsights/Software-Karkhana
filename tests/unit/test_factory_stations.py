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

"""Unit tests for Factory Station routers: Gemini AI, Products/Ideas, Architecture, QA, Security, DevOps."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.models import User
from app.routers.gemini import (
    EvaluateIdeaRequest,
    GenerateAdrsRequest,
    GenerateIdeasRequest,
    evaluate_idea,
    generate_adrs,
    generate_ideas,
)
from app.routers.operations import (
    ADRCreatePayload,
    create_adr,
    execute_qa_test_suite,
    get_swarm_status,
    list_adrs,
    list_pipelines,
    list_qa_scenarios,
    list_security_findings,
    trigger_deployment,
    trigger_security_scan,
)
from app.routers.products import (
    IdeaCreatePayload,
    ProductCreatePayload,
    create_idea,
    create_product,
)
from app.workspace_access import WorkspaceAccess


@pytest.fixture
def mock_user():
    return User(
        id=uuid.uuid4(),
        email="lead@enterprise.internal",
        display_name="Enterprise Lead",
        role="product_manager",
        is_active=True,
    )


@pytest.mark.asyncio
async def test_gemini_evaluate_and_brainstorm():
    # Evaluate idea
    eval_req = EvaluateIdeaRequest(
        title="High Throughput SSE Event Gateway",
        problem="High connection drops on HTTP/1.1",
        description="Migrate to HTTP/2 SSE streaming with connection pooling",
    )
    eval_resp = await evaluate_idea(eval_req)
    assert "assessment" in eval_resp
    assert "overallScore" in eval_resp["assessment"]
    assert eval_resp["assessment"]["overallScore"] >= 60

    # Brainstorm ideas
    ideas_req = GenerateIdeasRequest(prompt="AI code review", count=2)
    ideas_resp = await generate_ideas(ideas_req)
    assert "ideas" in ideas_resp
    assert len(ideas_resp["ideas"]) == 2

    # Generate ADRs
    adr_req = GenerateAdrsRequest(systemName="Core Gateway")
    adr_resp = await generate_adrs(adr_req)
    assert "adrs" in adr_resp
    assert len(adr_resp["adrs"]) >= 1


@pytest.mark.asyncio
async def test_products_and_ideas_endpoints(mock_user):
    mock_session = AsyncMock()
    mock_session.scalar.return_value = None
    mock_session.scalars.return_value.all.return_value = []
    ws_id = uuid.uuid4()

    def level(access, owner=False):
        return AsyncMock(return_value=WorkspaceAccess(ws_id, mock_user, "product_manager", owner, access))

    # Create product: only the workspace owner or an admin may.
    prod_req = ProductCreatePayload(name="Enterprise Engine", domain="Cloud Services", workspace_id=str(ws_id))
    with patch("app.access.workspace_member", AsyncMock(return_value=object())):
        with patch("app.workspace_access.workspace_access", level("member")), pytest.raises(HTTPException) as denied:
            await create_product(prod_req, BackgroundTasks(), mock_session, mock_user)
        assert denied.value.status_code == 403
        with (
            patch("app.workspace_access.workspace_access", level("owner", owner=True)),
            patch("app.routers.products.notify_workspace", AsyncMock()),
            patch("app.routers.products.notify_activity", AsyncMock()),
        ):
            prod = await create_product(prod_req, BackgroundTasks(), mock_session, mock_user)
    assert prod["name"] == "Enterprise Engine"
    assert prod["code"] == "ENTERP"

    # Create idea: refused outside any workspace, filed in the primary one otherwise.
    idea_req = IdeaCreatePayload(
        title="Automated Rollback Engine",
        problem_statement="Deployments can fail",
        expected_value="Zero downtime auto rollback",
    )
    with pytest.raises(HTTPException) as exc:
        await create_idea(idea_req, mock_session, mock_user)
    assert exc.value.status_code == 422

    # Guides and reviewers are read-only, so they cannot file ideas.
    for readonly in ("guide", "reviewer"):
        mock_session.scalar.side_effect = None
        mock_session.scalar.return_value = ws_id
        with patch("app.workspace_access.workspace_access", level(readonly)), pytest.raises(HTTPException) as ro:
            await create_idea(idea_req, mock_session, mock_user)
        assert ro.value.status_code == 403

    replies = iter([ws_id])  # the caller's primary workspace; later lookups find nothing
    mock_session.scalar.side_effect = lambda *a, **k: next(replies, None)
    idea = await create_idea(idea_req, mock_session, mock_user)
    assert idea["title"] == "Automated Rollback Engine"
    assert idea["status"] == "draft"


@pytest.mark.asyncio
async def test_operations_station_endpoints(mock_user):
    mock_session = AsyncMock()
    mock_session.scalar.return_value = None

    # Architecture ADRs
    adrs = await list_adrs(mock_user)
    assert len(adrs) >= 2

    new_adr = await create_adr(
        ADRCreatePayload(
            title="Adopt Cloud Run for Zero Cold Start",
            context="Container autoscaling requirement",
            decision="Deploy microservices on Cloud Run",
        ),
        mock_session,
        mock_user,
    )
    assert new_adr["title"] == "Adopt Cloud Run for Zero Cold Start"

    # Swarm status
    swarm = await get_swarm_status(mock_user)
    assert swarm["activeWorkers"] >= 1
    assert swarm["successRate"] == "100%"

    # QA Scenarios & Execute
    qa_list = await list_qa_scenarios(mock_user)
    assert len(qa_list) >= 3

    qa_run = await execute_qa_test_suite(mock_session, mock_user)
    assert qa_run["status"] == "passed"
    assert qa_run["passedCount"] >= 3

    # Security scan
    sec_list = await list_security_findings(mock_user)
    assert len(sec_list) >= 2

    sec_scan = await trigger_security_scan(mock_session, mock_user)
    assert sec_scan["status"] == "completed"
    assert sec_scan["critical"] == 0

    # DevOps pipelines & deployment
    pipes = await list_pipelines(mock_user)
    assert len(pipes) >= 3

    deploy = await trigger_deployment(mock_session, mock_user)
    assert deploy["status"] == "deployed"
    assert deploy["service"] == "karkhana-control-plane"
