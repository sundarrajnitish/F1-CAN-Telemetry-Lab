function run_tests()
%RUN_TESTS  Toolbox-free checks for the MATLAB side. Runs in MATLAB and GNU Octave:
%   cd matlab/tests; run_tests
%   octave --no-gui --eval "cd matlab/tests; run_tests"

    here = fileparts(mfilename('fullpath'));
    addpath(fullfile(here, '..'));
    n = 0;

    % 1. CRC-8 SAE J1850 check value
    assert(f1can_crc8(double('123456789')) == hex2dec('4B'));  n = n + 1;

    % 2. Frame produced by the Python encoder (python -m f1can dump), car #1 on the start line:
    %    speed 284.3 km/h, 11236 rpm, 100 % throttle, 7th gear, alive counter 0
    [name, v, ok] = f1can_decode(hex2dec('101'), hex2dec({'1B';'0B';'E4';'2B';'64';'07';'00';'4D'})');
    assert(ok && strcmp(name, 'F1_CarTelemetry'));
    assert(abs(v.Speed - 284.3) < 1e-9 && v.RPM == 11236 && v.Throttle == 100 && v.Gear == 7);  n = n + 1;

    % 3. RPM above 255 survives (v1: bitshift on uint8 kept only the low byte)
    assert(v.RPM > 255);  n = n + 1;

    % 4. Any single bit flip is caught by the CRC
    good = hex2dec({'1B';'0B';'E4';'2B';'64';'07';'00';'4D'})';
    for byte = 1:8
        for bit = 0:7
            bad = good; bad(byte) = bitxor(bad(byte), 2^bit);
            [~, ~, okBad] = f1can_decode(hex2dec('101'), bad);
            assert(~okBad);
        end
    end
    n = n + 1;

    % 5. Signed position signal
    [~, p, ok] = f1can_decode(hex2dec('103'), [4, 248, 0, 0, 131, 0, 1, 244]);
    assert(ok && abs(p.PosX - (-204.4)) < 1e-9 && p.DriverNumber == 1 && abs(p.PosZ - 13.1) < 1e-9);  n = n + 1;

    % 6. Full offline replay of the bundled trace: 3 cars, no errors, real lap length
    st = CAN_Replay_Offline(fullfile(here, '..', '..', 'data', 'sample_trace_canada2023.log'), tempname(), false);
    assert(numel(st.logs) == 3 && st.stats.crcErrors == 0 && st.stats.counterGaps == 0);
    ver = st.logs([st.logs.driver] == 1).rows;
    assert(max(ver(:, 3)) > 4250 && max(ver(:, 4)) > 300 && max(ver(:, 5)) > 11000 && max(ver(:, 6)) == 8);
    n = n + 1;

    % 7. Bundled dataset reads with text columns
    T = f1can_read_log(fullfile(here, '..', '..', 'data', 'canada2023_fastest_laps.csv'));
    assert(numel(unique(T.driver)) == 20 && iscell(T.abbr));  n = n + 1;

    fprintf('MATLAB/Octave tests: %d passed\n', n);
end
