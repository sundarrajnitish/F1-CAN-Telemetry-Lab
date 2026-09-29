function st = CAN_Replay_Offline(traceFile, outDir, showPlots)
%CAN_REPLAY_OFFLINE  Decode a candump-format trace with no toolbox and no hardware.
%
%   st = CAN_Replay_Offline()                         % uses ../data/sample_trace_canada2023.log
%   st = CAN_Replay_Offline('trace.log', 'logs', true)
%
%   Produce your own trace with:  python -m f1can dump --drivers 1,14,44 --out trace.log
%   Each line looks like  (0000000012.300000) vcan0 101#1B0BE42B6407004D
%
%   Runs in MATLAB and GNU Octave. This is the recommended first step if you do not own
%   Vector hardware: it exercises exactly the same decoder and logger as CAN_Receive_Logger.

    here = fileparts(mfilename('fullpath'));
    if nargin < 1 || isempty(traceFile)
        traceFile = fullfile(here, '..', 'data', 'sample_trace_canada2023.log');
    end
    if nargin < 2 || isempty(outDir), outDir = fullfile(here, 'logs'); end
    if nargin < 3, showPlots = true; end

    txt = fileread(traceFile);
    tok = regexp(txt, '\(([\d.]+)\)\s+\S+\s+([0-9A-Fa-f]+)#([0-9A-Fa-f]*)', 'tokens');
    fprintf('%s: %d frames\n', traceFile, numel(tok));

    st = f1can_logger();
    for k = 1:numel(tok)
        id = hex2dec(tok{k}{2});
        hex = tok{k}{3};
        data = hex2dec(reshape(hex, 2, [])')';
        st = f1can_logger(st, id, data);
    end
    s = st.stats;
    fprintf('samples=%d  crcErrors=%d  counterGaps=%d  unknown=%d\n', s.samples, s.crcErrors, s.counterGaps, s.unknown);
    f1can_write_log(st.logs, outDir);

    if showPlots && ~isempty(st.logs)
        f1can_plot_logs(st.logs);
    end
end

function f1can_plot_logs(logs)
    figure('Name', 'F1 CAN replay - fastest laps', 'NumberTitle', 'off', 'Color', 'w');
    labels = {'Speed [km/h]', 'Throttle [%]', 'Gear', 'RPM'};
    cols = [4, 7, 6, 5];
    for p = 1:4
        subplot(4, 1, p); hold on; grid on;
        for k = 1:numel(logs)
            r = logs(k).rows;
            if cols(p) == 6
                stairs(r(:, 3), r(:, cols(p)));
            else
                plot(r(:, 3), r(:, cols(p)));
            end
        end
        ylabel(labels{p});
    end
    xlabel('Lap distance [m]');
    legend(arrayfun(@(l) sprintf('#%d', l.driver), logs, 'UniformOutput', false), 'Location', 'eastoutside');
end
