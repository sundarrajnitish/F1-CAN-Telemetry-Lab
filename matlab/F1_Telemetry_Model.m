function mdl = F1_Telemetry_Model(driver, openModel)
%F1_TELEMETRY_MODEL  Build a toolbox-free Simulink model that replays a REAL 2023 Canadian GP lap.
%
%   F1_Telemetry_Model          % car #1 (Verstappen), opens and is ready to Run
%   F1_Telemetry_Model(14)      % Alonso
%
%   The v1 "Universal" model generated sine waves (speed 0-200 km/h at 0.1 Hz) because the CAN
%   blocks needed Vector hardware. This version keeps the same idea - only core Simulink blocks,
%   any recent release, no hardware - but plays back the actual fastest lap from
%   data/canada2023_fastest_laps.csv. A second branch passes speed through the v1 8-bit
%   Saturation (0..255 km/h) so the defect is visible side by side on one scope.
%
%   For live CAN in Simulink use Vehicle Network Toolbox: CAN Configuration + CAN Receive +
%   CAN Unpack blocks, with dbc/f1_telemetry.dbc selected in CAN Unpack (message F1_CarTelemetry).

    if nargin < 1 || isempty(driver), driver = 1; end
    if nargin < 2, openModel = true; end

    here = fileparts(mfilename('fullpath'));
    T = f1can_read_log(fullfile(here, '..', 'data', 'canada2023_fastest_laps.csv'));
    sel = T.driver == driver;
    if ~any(sel), error('f1can:model', 'car #%d not in the bundled dataset', driver); end
    [t, iu] = unique(T.time_s(sel));           % From Workspace needs strictly increasing time
    col = @(name) pick(T.(name)(sel), iu);
    cont = [t, col('speed_kph'), col('throttle_pct'), col('rpm'), col('distance_m')];
    disc = [t, col('gear'), col('brake'), col('drs')];
    assignin('base', 'f1_cont', cont);
    assignin('base', 'f1_disc', disc);

    mdl = 'F1_Telemetry_Replay';
    if bdIsLoaded(mdl), close_system(mdl, 0); end
    new_system(mdl);
    set_param(mdl, 'SolverType', 'Fixed-step', 'Solver', 'FixedStepDiscrete', 'FixedStep', '0.05', ...
              'StopTime', sprintf('%.3f', t(end)));

    x0 = 40; y0 = 60;
    blk = @(name) [mdl '/' name];
    pos = @(x, y, w, h) [x, y, x + w, y + h];

    add_block('simulink/Sources/From Workspace', blk('Lap (continuous)'), 'VariableName', 'f1_cont', ...
              'Interpolate', 'on', 'SampleTime', '0.05', 'Position', pos(x0, y0, 110, 50));
    add_block('simulink/Sources/From Workspace', blk('Lap (discrete)'), 'VariableName', 'f1_disc', ...
              'Interpolate', 'off', 'SampleTime', '0.05', 'Position', pos(x0, y0 + 260, 110, 50));
    add_block('simulink/Signal Routing/Demux', blk('ContDemux'), 'Outputs', '4', 'Position', pos(x0 + 170, y0 - 20, 8, 110));
    add_block('simulink/Signal Routing/Demux', blk('DiscDemux'), 'Outputs', '3', 'Position', pos(x0 + 170, y0 + 245, 8, 80));
    add_line(mdl, 'Lap (continuous)/1', 'ContDemux/1');
    add_line(mdl, 'Lap (discrete)/1', 'DiscDemux/1');

    names = {'Speed', 'Throttle', 'RPM', 'Distance'};
    for i = 1:4
        y = y0 - 30 + (i - 1) * 55;
        add_block('simulink/Sinks/Display', blk([names{i} ' display']), 'Position', pos(x0 + 470, y, 90, 30));
        add_line(mdl, sprintf('ContDemux/%d', i), [names{i} ' display/1'], 'autorouting', 'on');
    end
    dnames = {'Gear', 'Brake', 'DRS'};
    for i = 1:3
        y = y0 + 235 + (i - 1) * 45;
        add_block('simulink/Sinks/Display', blk([dnames{i} ' display']), 'Position', pos(x0 + 470, y, 60, 30));
        add_line(mdl, sprintf('DiscDemux/%d', i), [dnames{i} ' display/1'], 'autorouting', 'on');
    end

    % v1 defect, visualised: 8-bit speed signal saturates at 255 km/h
    add_block('simulink/Discontinuities/Saturation', blk('v1 8-bit speed'), 'UpperLimit', '255', ...
              'LowerLimit', '0', 'Position', pos(x0 + 260, y0 + 120, 50, 34));
    add_line(mdl, 'ContDemux/1', 'v1 8-bit speed/1', 'autorouting', 'on');
    add_block('simulink/Signal Routing/Mux', blk('SpeedMux'), 'Inputs', '2', 'Position', pos(x0 + 360, y0 + 105, 6, 60));
    add_line(mdl, 'ContDemux/1', 'SpeedMux/1', 'autorouting', 'on');
    add_line(mdl, 'v1 8-bit speed/1', 'SpeedMux/2', 'autorouting', 'on');
    add_block('simulink/Sinks/Scope', blk('Speed v2 vs v1'), 'Position', pos(x0 + 620, y0 + 115, 40, 40));
    add_line(mdl, 'SpeedMux/1', 'Speed v2 vs v1/1', 'autorouting', 'on');

    % Driver-inputs scope: throttle, gear, brake
    add_block('simulink/Signal Routing/Mux', blk('InputsMux'), 'Inputs', '3', 'Position', pos(x0 + 360, y0 + 200, 6, 70));
    add_line(mdl, 'ContDemux/2', 'InputsMux/1', 'autorouting', 'on');
    add_line(mdl, 'DiscDemux/1', 'InputsMux/2', 'autorouting', 'on');
    add_line(mdl, 'DiscDemux/2', 'InputsMux/3', 'autorouting', 'on');
    add_block('simulink/Sinks/Scope', blk('Throttle / Gear / Brake'), 'Position', pos(x0 + 620, y0 + 215, 40, 40));
    add_line(mdl, 'InputsMux/1', 'Throttle / Gear / Brake/1', 'autorouting', 'on');

    add_block('simulink/Sinks/Scope', blk('RPM scope'), 'Position', pos(x0 + 620, y0 + 40, 40, 40));
    add_line(mdl, 'ContDemux/3', 'RPM scope/1', 'autorouting', 'on');

    add_block('simulink/Sinks/To Workspace', blk('Log'), 'VariableName', 'f1_log', ...
              'SaveFormat', 'Structure With Time', 'Position', pos(x0 + 620, y0 + 300, 70, 30));
    add_line(mdl, 'Lap (continuous)/1', 'Log/1', 'autorouting', 'on');

    set_param(mdl, 'Location', [60 60 1000 560]);
    if openModel, open_system(mdl); end
    fprintf('Built %s for car #%d (%.3f s lap). Press Run.\n', mdl, driver, t(end));
end

function y = pick(v, idx)
    y = v(idx);
end
