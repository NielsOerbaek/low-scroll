import pytest
from unittest.mock import patch, MagicMock
from src.facebook import FacebookClient


MOCK_GROUP_HTML = """
<html><head><title>Test Group</title></head><body>
<div id="m_group_stories_container">
  <div class="bx">
    <div>
      <h3><a href="/profile.php?id=111">John Doe</a></h3>
      <div class="dx">
        <p>This is a test post about something interesting</p>
      </div>
      <div>
        <abbr data-utime="1737000000">Jan 15</abbr>
      </div>
      <div>
        <a href="/groups/123/posts/456/">Full Story</a>
        <a href="/groups/123/posts/456/">5 Comments</a>
      </div>
    </div>
  </div>
</div>
</body></html>
"""

MOCK_HOME_HTML = """
<html><head><title>Facebook</title></head><body>
<div id="mbasic_logout_button"><a href="/logout">Logout</a></div>
</body></html>
"""

MOCK_LOGIN_HTML = """
<html><head><title>Log into Facebook</title></head><body>
<form id="login_form"></form>
</body></html>
"""


@pytest.fixture
def fb_client():
    with patch.object(FacebookClient, 'random_delay'):
        client = FacebookClient({"c_user": "123", "xs": "secret"})
        yield client


def test_validate_session_valid(fb_client):
    mock_resp = MagicMock()
    mock_resp.text = MOCK_HOME_HTML
    mock_resp.status_code = 200
    mock_resp.url = "https://mbasic.facebook.com/"
    with patch.object(fb_client._session, 'get', return_value=mock_resp):
        assert fb_client.validate_session() is True


def test_validate_session_invalid(fb_client):
    mock_resp = MagicMock()
    mock_resp.text = MOCK_LOGIN_HTML
    mock_resp.status_code = 200
    mock_resp.url = "https://mbasic.facebook.com/login/"
    with patch.object(fb_client._session, 'get', return_value=mock_resp):
        assert fb_client.validate_session() is False


def test_get_group_name(fb_client):
    mock_resp = MagicMock()
    mock_resp.text = MOCK_GROUP_HTML
    mock_resp.status_code = 200
    with patch.object(fb_client._session, 'get', return_value=mock_resp):
        name = fb_client.get_group_name("123")
        assert name == "Test Group"
