import logging
import os
import aiohttp
from aiohttp import web

# Set up logger
logger = logging.getLogger(__name__)

# Constants for configuration, can be overridden by environment variables
LICENSE_SERVER_URL = os.environ.get("LICENSE_SERVER_URL", "https://tis-license.in/api/")
HA_ADDRESS = os.environ.get("HA_ADDRESS", "http://homeassistant:8123")


class LicenseManager:
    """Handles the communication with license servers."""

    def __init__(self, ha_address=None, license_server_url=None):
        self.ha_address = ha_address or HA_ADDRESS
        self.license_server_url = license_server_url or LICENSE_SERVER_URL
        logger.info(
            f"[LicenseManager] Initialized with HA_ADDRESS: {self.ha_address} and LICENSE_SERVER: {self.license_server_url}"
        )

    async def verify_license(self):
        """
        Fetches and verifies the license key.
        Matches the logic of the PHP fetchLicenseFromRemote function.
        """
        try:
            url_get_key = f"{self.ha_address.rstrip('/')}/api/get_key"
            logger.info(f"[LicenseManager] Step 1: Fetching key from {url_get_key}")

            async with aiohttp.ClientSession() as session:
                async with session.get(url_get_key, timeout=10) as resp:
                    logger.info(f"[LicenseManager] HA Response status: {resp.status}")
                    if resp.status == 200:
                        data = await resp.json()
                        if data and "key" in data:
                            key = data["key"]
                            logger.info(
                                "[LicenseManager] Step 2: Key found. Verifying with remote server..."
                            )

                            verify_url = f"{self.license_server_url.rstrip('/')}/verify"
                            logger.info(
                                f"[LicenseManager] Hitting verify URL: {verify_url} with mac={key}"
                            )

                            async with session.get(
                                verify_url, params={"mac": key}, timeout=10
                            ) as response:
                                logger.info(
                                    f"[LicenseManager] Remote Server Response status: {response.status}"
                                )

                                if response.status == 200:
                                    res_json = await response.json()
                                    logger.info(
                                        f"[LicenseManager] Remote Server Response JSON: {res_json}"
                                    )
                                    if res_json.get("status") == "success":
                                        logger.info(
                                            "[LicenseManager] ✅ License verification SUCCESSFUL"
                                        )
                                        return res_json
                                    else:
                                        logger.warning(
                                            f"[LicenseManager] ❌ License verification FAILED: {res_json.get('message')}"
                                        )

                                if response.status == 401:
                                    logger.error(
                                        "[LicenseManager] ❌ 401 Unauthorized: License expired"
                                    )
                                    return {"status": 401, "message": "License expired"}
                                elif response.status == 404:
                                    logger.error(
                                        "[LicenseManager] ❌ 404 Not Found: License endpoint issue"
                                    )
                                    return {"status": 404, "message": "Unauthorized"}

                                logger.error(
                                    f"[LicenseManager] ❌ Unexpected remote status: {response.status}"
                                )
                                return None
                        else:
                            logger.error(
                                "[LicenseManager] ❌ No 'key' field in HA JSON response"
                            )
                            return None
                    else:
                        logger.error(
                            f"[LicenseManager] ❌ Failed to connect to HA API. Status: {resp.status}"
                        )
                        return None
        except Exception as e:
            logger.error(
                f"[LicenseManager] ❌ Exception during verification: {str(e)}",
                exc_info=True,
            )
            return None


@web.middleware
async def license_middleware(request: web.Request, handler):
    """
    aiohttp middleware to protect routes.
    """
    # 1. Bypass check for health and utility routes
    if request.path in ["/health", "/metrics", "/ca.crt"]:
        return await handler(request)

    logger.info(f"[Middleware] Incoming request: {request.method} {request.path}")

    # 2. Perform license check
    manager = LicenseManager()
    license_data = await manager.verify_license()

    # Success
    if license_data and license_data.get("status") == "success":
        return await handler(request)

    # Error Handling
    logger.warning(f"[Middleware] Blocking request to {request.path} - License invalid")

    if license_data and isinstance(license_data, dict):
        status = license_data.get("status", 401)
        message = license_data.get("message", "Unauthorized")
        try:
            status_int = int(status)
        except:
            status_int = 401

        return web.json_response(
            {"status": "error", "message": message}, status=status_int
        )

    return web.json_response(
        {"status": "error", "message": "Unauthorized: License verification failed"},
        status=401,
    )
