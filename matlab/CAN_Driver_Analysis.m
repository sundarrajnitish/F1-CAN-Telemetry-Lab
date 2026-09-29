function R = CAN_Driver_Analysis(fileA, fileB, showPlot)
%CAN_DRIVER_ANALYSIS  Compare two logged fastest laps on lap distance, with a time-delta trace.
%
%   R = CAN_Driver_Analysis('logs/driver_01_telemetry.csv', 'logs/driver_14_telemetry.csv')
%   R = CAN_Driver_Analysis()          % lists logs/ and asks for two indices
%
%   v1 rebuilt distance with cumtrapz(speed) over *receiver* timestamps written with one-second
%   resolution, so most dt were 0 and the lap came out a few hundred metres long. v2 uses the
%   lap distance and lap time that the car itself sent in F1_LapContext.
%
%   R.distance, R.a / R.b (resampled channels), R.delta (s, + = B behind A), R.minisectorWinner.

    if nargin < 3, showPlot = true; end
    if nargin < 2
        files = dir(fullfile('logs', 'driver_*_telemetry.csv'));
        if numel(files) < 2, error('f1can:analysis', 'need at least two logs in ./logs'); end
        for k = 1:numel(files), fprintf('%2d: %s\n', k, files(k).name); end
        i1 = input('first driver index: ');
        i2 = input('second driver index: ');
        fileA = fullfile(files(i1).folder, files(i1).name);
        fileB = fullfile(files(i2).folder, files(i2).name);
    end

    A = f1can_read_log(fileA);
    B = f1can_read_log(fileB);
    step = 5;
    dEnd = min(max(A.distance_m), max(B.distance_m));
    R.distance = (0:step:dEnd)';
    R.a = onGrid(A, R.distance);
    R.b = onGrid(B, R.distance);
    R.delta = R.b.t - R.a.t;
    R.labelA = sprintf('#%d', A.driver(1));
    R.labelB = sprintf('#%d', B.driver(1));

    edges = linspace(0, dEnd, 26);
    tA = interp1(R.distance, R.a.t, edges, 'linear', 'extrap');
    tB = interp1(R.distance, R.b.t, edges, 'linear', 'extrap');
    R.minisectorWinner = double(diff(tB) < diff(tA));     % 0 = A faster, 1 = B faster
    fprintf('%s vs %s: gap at the line %+.3f s, %s quicker in %d of 25 mini-sectors\n', ...
        R.labelA, R.labelB, R.delta(end), R.labelA, sum(R.minisectorWinner == 0));

    if showPlot, plotComparison(R); end
end

function G = onGrid(T, d)
    [x, iu] = unique(T.distance_m);               % receiver may log repeated distances at standstill
    G.t        = interp1(x, T.lap_time_s(iu), d, 'linear', 'extrap');
    G.speed    = interp1(x, T.speed_kph(iu), d, 'linear', 'extrap');
    G.throttle = interp1(x, T.throttle_pct(iu), d, 'linear', 'extrap');
    G.rpm      = interp1(x, T.rpm(iu), d, 'linear', 'extrap');
    G.gear     = interp1(x, T.gear(iu), d, 'previous', 'extrap');
    G.brake    = interp1(x, T.brake(iu), d, 'previous', 'extrap');
end

function plotComparison(R)
    ca = [0.12 0.47 0.71]; cb = [0.84 0.15 0.16];
    figure('Name', sprintf('%s vs %s', R.labelA, R.labelB), 'NumberTitle', 'off', 'Color', 'w');
    d = R.distance;
    subplot(5, 1, 1); plot(d, R.a.speed, 'Color', ca); hold on; plot(d, R.b.speed, 'Color', cb);
    ylabel('Speed [km/h]'); legend(R.labelA, R.labelB, 'Location', 'southeast'); grid on
    subplot(5, 1, 2); plot(d, R.a.throttle, 'Color', ca); hold on; plot(d, R.b.throttle, 'Color', cb);
    ylabel('Throttle [%]'); grid on
    subplot(5, 1, 3); stairs(d, R.a.gear, 'Color', ca); hold on; stairs(d, R.b.gear, 'Color', cb);
    ylabel('Gear'); grid on
    subplot(5, 1, 4); area(d, R.a.brake, 'FaceColor', ca, 'EdgeColor', 'none'); hold on;
    area(d, -R.b.brake, 'FaceColor', cb, 'EdgeColor', 'none'); ylabel('Brake'); grid on
    subplot(5, 1, 5); plot(d, R.delta, 'k', 'LineWidth', 1.2); hold on; plot(d([1 end]), [0 0], ':', 'Color', [.5 .5 .5]);
    ylabel(sprintf('\\Delta t %s-%s [s]', R.labelB, R.labelA)); xlabel('Lap distance [m]'); grid on
end
