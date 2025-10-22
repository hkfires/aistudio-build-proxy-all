import multiprocessing
import os

from browser.instance import run_browser_instance
from utils.logger import setup_logging
from utils.paths import cookies_dir, logs_dir


def _clean_env_value(raw):
    if raw is None:
        return None
    stripped = raw.strip()
    return stripped or None


def load_instances_from_env(logger):
    """
    解析环境变量中的配置，生成与原 YAML 格式兼容的 global_settings 和 instances。
    """
    count_raw = os.getenv("CAMOUFOX_INSTANCE_COUNT", "0")
    try:
        instance_count = int(count_raw)
    except ValueError:
        logger.error(f"错误: CAMOUFOX_INSTANCE_COUNT 必须是整数，目前的值为: {count_raw}")
        return None, None

    if instance_count <= 0:
        logger.error("错误: CAMOUFOX_INSTANCE_COUNT 必须大于 0。")
        return None, None

    global_settings = {
        "headless": _clean_env_value(os.getenv("CAMOUFOX_HEADLESS")) or "virtual"
    }

    proxy_value = _clean_env_value(os.getenv("CAMOUFOX_PROXY"))
    if proxy_value:
        global_settings["proxy"] = proxy_value

    instances = []
    for index in range(1, instance_count + 1):
        prefix = f"CAMOUFOX_INSTANCE_{index}_"
        cookie_file = _clean_env_value(os.getenv(f"{prefix}COOKIE_FILE"))
        url = _clean_env_value(os.getenv(f"{prefix}URL"))

        profile = {}
        if cookie_file:
            profile["cookie_file"] = cookie_file
        if url:
            profile["url"] = url

        headless_override = _clean_env_value(os.getenv(f"{prefix}HEADLESS"))
        if headless_override:
            profile["headless"] = headless_override

        proxy_override = _clean_env_value(os.getenv(f"{prefix}PROXY"))
        if proxy_override:
            profile["proxy"] = proxy_override

        instances.append(profile)

    return global_settings, instances


def main():
    """
    主函数，读取环境变量并为每个实例启动一个独立的浏览器进程。
    """
    log_dir = logs_dir()
    os.makedirs(log_dir, exist_ok=True)
    os.makedirs(cookies_dir(), exist_ok=True)

    logger = setup_logging(str(log_dir / 'app.log'))

    logger.info("---------------------Camoufox 实例管理器开始启动---------------------")

    global_settings, instance_profiles = load_instances_from_env(logger)
    if not instance_profiles:
        logger.error("错误: 环境变量中未找到任何实例配置。")
        return

    processes = []
    for profile in instance_profiles:
        final_config = global_settings.copy()
        final_config.update(profile)

        if 'cookie_file' not in final_config or 'url' not in final_config:
            logger.warning(f"警告: 跳过一个无效的配置项 (缺少 cookie_file 或 url): {profile}")
            continue

        cookie_candidate = final_config['cookie_file']
        if os.path.basename(cookie_candidate) != cookie_candidate:
            logger.error(
                f"错误: cookie_file 只能提供文件名，不允许携带路径: {cookie_candidate}"
            )
            continue

        if not cookie_candidate.lower().endswith('.json'):
            logger.error(
                f"错误: cookie_file 必须是 .json 文件: {cookie_candidate}"
            )
            continue

        cookies_root = cookies_dir().resolve()
        resolved_cookie = (cookies_root / cookie_candidate).resolve()
        if cookies_root not in resolved_cookie.parents and resolved_cookie != cookies_root:
            logger.error(
                f"错误: cookie_file 必须位于 cookies/ 目录下: {cookie_candidate}"
            )
            continue

        process = multiprocessing.Process(target=run_browser_instance, args=(final_config,))
        processes.append(process)
        process.start()

    if not processes:
        logger.error("错误: 没有有效的实例配置可以启动。")
        return

    logger.info(f"已成功启动 {len(processes)} 个浏览器实例。按 Ctrl+C 终止所有实例。")

    try:
        for process in processes:
            process.join()
    except KeyboardInterrupt:
        logger.info("捕获到 Ctrl+C, 正在终止所有子进程...")
        for process in processes:
            process.terminate()
            process.join()
        logger.info("所有进程已终止。")

if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
