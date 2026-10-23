#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <string.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <fcntl.h>

#define BARS_FILE "/tmp/cava_bars.txt"
#define PID_FILE "/tmp/cava_bridge.pid"
#define HEARTBEAT_FILE "/tmp/cava_heartbeat.txt"
#define NUM_BARS 28

static const char *get_bridge_script(int argc, char *argv[]) {
    if (argc > 1 && argv[1] && argv[1][0] != '\0') {
        return argv[1];
    }
    static const char *fallback_paths[] = {
        "/Users/hhamelin/Library/Application Support/Übersicht/widgets/cava.widget/cava_bridge.py",
        "./cava.widget/cava_bridge.py",
        "cava_bridge.py"
    };
    for (int i = 0; i < 3; i++) {
        if (access(fallback_paths[i], R_OK) == 0) {
            return fallback_paths[i];
        }
    }
    return fallback_paths[0];
}

int main(int argc, char *argv[]) {
    // 1. Touch heartbeat file so worker knows visualizer is active
    int hbf = open(HEARTBEAT_FILE, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (hbf >= 0) {
        char ts[32];
        int len = snprintf(ts, sizeof(ts), "%ld\n", (long)time(NULL));
        write(hbf, ts, len);
        close(hbf);
    }

    // 2. Check if worker is running
    int worker_running = 0;
    FILE *pf = fopen(PID_FILE, "r");
    if (pf) {
        int pid = 0;
        if (fscanf(pf, "%d", &pid) == 1 && pid > 0) {
            if (kill(pid, 0) == 0) {
                worker_running = 1;
            }
        }
        fclose(pf);
    }

    // 3. If worker is not running, spawn it in background
    if (!worker_running) {
        const char *bridge = get_bridge_script(argc, argv);
        pid_t p = fork();
        if (p == 0) {
            setsid();
            int devnull = open("/dev/null", O_RDWR);
            if (devnull >= 0) {
                dup2(devnull, STDIN_FILENO);
                dup2(devnull, STDOUT_FILENO);
                dup2(devnull, STDERR_FILENO);
                close(devnull);
            }
            execlp("python3", "python3", bridge, "--run", (char *)NULL);
            _exit(1);
        }
    }

    // 4. Output current bars immediately
    FILE *bf = fopen(BARS_FILE, "r");
    if (bf) {
        char buf[512];
        if (fgets(buf, sizeof(buf), bf)) {
            fputs(buf, stdout);
            fclose(bf);
            return 0;
        }
        fclose(bf);
    }

    // Fallback if worker just started or file is empty
    for (int i = 0; i < NUM_BARS; i++) {
        fputs("0;", stdout);
    }
    putchar('\n');
    return 0;
}
