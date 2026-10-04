function st = CAN_Receive_Logger(vendor, device, channel, outDir)
%CAN_RECEIVE_LOGGER  Live receiver + dashboard for the F1 CAN Telemetry Lab (Vehicle Network Toolbox).
%
%   CAN_Receive_Logger                                % Vector 'Virtual 1', channel 1, 500 kbit/s
%   CAN_Receive_Logger('Vector', 'VN1610 1', 1, 'logs')
%   CAN_Receive_Logger('PEAK-System', 'PCAN_USBBUS1', 1)
%
%   Start it first, then run the sender:
%       python -m f1can send --interface vector --channel 0      (Vector virtual/hardware)
%
%   Design notes:
%     * frames are drained in batches with receive(ch, Inf)
%     * bytes are decoded as double by the toolbox-free f1can_decode
%     * cars are identified by the driver number carried on the bus
%     * lap time and lap distance come from the car, so logs never depend on receiver timing
%     * CRC-8 and alive counter are checked; the title bar reports any errors
%     * the loop ends on END_SESSION, when the window is closed, or after 10 s of silence

    if nargin < 1 || isempty(vendor),  vendor = 'Vector'; end
    if nargin < 2 || isempty(device),  device = 'Virtual 1'; end
    if nargin < 3 || isempty(channel), channel = 1; end
    if nargin < 4 || isempty(outDir),  outDir = 'logs'; end

    ch = canChannel(vendor, device, channel);
    cleanup = onCleanup(@() stopChannel(ch)); %#ok<NASGU>
    try
        configBusSpeed(ch, 500000);
    catch
        % Virtual channels and some interfaces do not allow changing the bit rate - that is fine.
    end
    start(ch);

    [fig, h] = buildDashboard();
    st = f1can_logger();
    lastRx = tic;
    fprintf('Listening on %s %s ch%d ... run the Python sender now.\n', vendor, device, channel);

    while ishandle(fig) && ~st.finished
        msgs = receive(ch, Inf);
        if isempty(msgs)
            if toc(lastRx) > 10
                disp('No frames for 10 s - stopping.');
                break
            end
            pause(0.02);
            continue
        end
        lastRx = tic;
        for k = 1:numel(msgs)
            if msgs(k).Remote || msgs(k).Error, continue, end
            prevDriver = st.current;
            st = f1can_logger(st, msgs(k).ID, msgs(k).Data);
            if ~isnan(st.current) && ~isequal(prevDriver, st.current)
                resetDashboard(h, st.current);
            end
            if ~isempty(st.newRow)
                updateDashboard(h, st.newRow);
            end
        end
        s = st.stats;
        set(fig, 'Name', sprintf('F1 telemetry  |  samples %d  CRC errors %d  counter gaps %d', ...
            s.samples, s.crcErrors, s.counterGaps));
        drawnow limitrate
    end

    f1can_write_log(st.logs, outDir);
end

% ------------------------------------------------------------------------------------------
function stopChannel(ch)
    try, stop(ch); catch, end
end

function [fig, h] = buildDashboard()
    fig = figure('Name', 'F1 telemetry', 'NumberTitle', 'off', 'Color', [0.08 0.09 0.12], ...
                 'Position', [80 80 1200 680]);
    tl = tiledlayout(fig, 3, 2, 'TileSpacing', 'compact', 'Padding', 'compact');
    spec = {'Speed [km/h]', [0 360], [0.25 0.55 1.0];
            'RPM',          [0 13000], [0.85 0.3 0.85];
            'Throttle [%]', [0 105], [0.2 0.8 0.35];
            'Gear',         [0 8.5], [1.0 0.72 0.1];
            'Brake',        [-0.05 1.05], [1.0 0.3 0.3];
            'Track map',    [], [1 1 1]};
    for i = 1:6
        ax = nexttile(tl);
        set(ax, 'Color', [0.11 0.12 0.16], 'XColor', [0.7 0.7 0.75], 'YColor', [0.7 0.7 0.75]);
        hold(ax, 'on'); grid(ax, 'on');
        title(ax, spec{i, 1}, 'Color', [0.9 0.9 0.92]);
        if i < 6
            ylim(ax, spec{i, 2}); xlim(ax, [0 4400]); xlabel(ax, 'Lap distance [m]');
            h.line(i) = animatedline(ax, 'Color', spec{i, 3}, 'LineWidth', 1.3);
        else
            axis(ax, 'equal'); xlabel(ax, 'x [m]'); ylabel(ax, 'y [m]');
            h.line(i) = animatedline(ax, 'Color', [0.6 0.6 0.65], 'LineWidth', 2);
            h.car = plot(ax, NaN, NaN, 'o', 'MarkerSize', 9, 'MarkerFaceColor', [1 0.72 0.1], 'MarkerEdgeColor', 'w');
        end
    end
    h.title = title(tl, 'waiting for a car ...', 'Color', 'w');
end

function resetDashboard(h, driver)
    for i = 1:6, clearpoints(h.line(i)); end
    h.title.String = sprintf('Car #%d - fastest lap', driver);
end

function updateDashboard(h, r)
    % r = [driver, lap, lap_time, distance, speed, rpm, gear, throttle, brake, drs, x, y, z]
    d = r(4);
    addpoints(h.line(1), d, r(5));
    addpoints(h.line(2), d, r(6));
    addpoints(h.line(3), d, r(8));
    addpoints(h.line(4), d, r(7));
    addpoints(h.line(5), d, r(9));
    addpoints(h.line(6), r(11), r(12));
    set(h.car, 'XData', r(11), 'YData', r(12));
end
