//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
pragma abicoder v2;


import '@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol';
import {IKyberRouter, IKyberFactory, IPoolWETHUSDT} from './interfaces/IKyber.sol';
import './interfaces/MyIERC20.sol';
import './interfaces/ICurve.sol';
import './libraries/Helpers.sol';
import './FlashLoaner.sol';
import './interfaces/I1inchProtocol.sol';
import './Swaper0x.sol';

import "hardhat/console.sol";




contract RevengeOfTheFlash {

    MyIERC20 USDT;
    MyIERC20 WBTC;
    MyIERC20 WETH;
    MyIERC20 USDC;
    MyIERC20 BNT;
    MyIERC20 TUSD;
    MyIERC20 ETH_Bancor;
    IWETH WETH_int;
    MyILendingPool lendingPoolAAVE;
    IContractRegistry ContractRegistry_Bancor;
    ICurve yPool;
    IUniswapV2Router02 sushiRouter;
    IUniswapV2Router02 uniswapRouter;
    I1inchProtocol oneInch;
    IBancorNetwork bancorNetwork;
    IKyberRouter kyberRouter;
    IKyberFactory kyberFactory;
    IBalancerV1 balancerWBTCETHpool_1;
    IBalancerV1 balancerWBTCETHpool_2; 


    struct ZrxQuote {
        address sellTokenAddress;
        address buyTokenAddress;
        address spender;
        address swapTarget;
        bytes swapCallData;
    }


    address swaper0x;
    address revengeOfTheFlash;
    



    function executeCont(
        ZrxQuote calldata _TUSDWETH_0x_quote
    ) public {
        //General variables
        uint amount;
        address[] memory _path;
        uint[] memory tradedAmounts;

        //0x - (TUSD to WETH)
        console.log('9. - WETH balance before TUSD swap: ', WETH.balanceOf(address(this)));
        
        (bool success, bytes memory returnData) = swaper0x.delegatecall(
            abi.encodeWithSignature('fillQuote(address,address,address,address,bytes)',
                _TUSDWETH_0x_quote.sellTokenAddress,
                _TUSDWETH_0x_quote.buyTokenAddress,
                _TUSDWETH_0x_quote.spender,
                _TUSDWETH_0x_quote.swapTarget,
                _TUSDWETH_0x_quote.swapCallData  
            )
        );

        // (bool success, bytes memory returnData) = swaper0x.delegatecall(
        //     abi.encodeWithSignature('useCurve()')
        // );
        
        require(success, 'TUSDWETH 0x swap failed');
        if (!success) {
            console.log(Helpers._getRevertMsg(returnData));
        }
        console.log('9. - WETH balance after TUSD swap: ', WETH.balanceOf(address(this)) / 1 ether);

        
        // UNISWAP - USDC to WBTC
        USDC.approve(address(uniswapRouter), type(uint).max);
        amount = 44739 * 10 ** 6;
        _path = Helpers._createPath(address(USDC), address(WBTC));
        tradedAmounts = uniswapRouter.swapExactTokensForTokens(amount, 0, _path, address(this), block.timestamp);
        console.log('10.- WBTC balance after swap (Uniswap): ', WBTC.balanceOf(address(this)) / 10 ** 8, '--', tradedAmounts[1]);


        //0x (using -deprecated- 1Inch protocol)
        //(USDC to WBTC)  
        amount = 984272 * 10 ** 6;
        USDC.approve(address(oneInch), type(uint).max);

        (uint expectedReturn, uint[] memory distribution) = oneInch.getExpectedReturn(
            USDC,
            WBTC,
            amount,
            10,
            0
        );
        oneInch.swap(USDC, WBTC, amount, 0, distribution,0); 

        console.log('11.- Amount of WBTC traded (0x - 1Inch): ', expectedReturn / 10 ** 8);
        console.log('___11.1.- WBTC balance after 0x swap (0x - 1Inch): ', WBTC.balanceOf(address(this)) / 10 ** 8);


        //BALANCER
        uint tokenAmountOut;
        //(1st WBTC/ETH swap)
        tokenAmountOut = balancerSwapV1(balancerWBTCETHpool_1, 1.74806084 * 10 ** 8);
        console.log('12.- Amount of WETH received (1st Balancer swap): ', tokenAmountOut / 1 ether);
        console.log('___12.1.- ETH balance after conversion from WETH: ', address(this).balance / 1 ether);

        //(2nd WBTC/ETH swap)
        tokenAmountOut = balancerSwapV1(balancerWBTCETHpool_2, 2.62209126 * 10 ** 8);
        console.log('13.- Amount of WETH received (2nd Balancer swap): ', tokenAmountOut / 1 ether);
        console.log('___13.1.- ETH balance after conversion from WETH: ', address(this).balance / 1 ether);
        

        //UNISWAP - (WBTC to ETH)
        WBTC.approve(address(uniswapRouter), type(uint).max);
        amount = 3.49612169 * 10 ** 8;
        _path = Helpers._createPath(address(WBTC), address(WETH));
        tradedAmounts = uniswapRouter.swapExactTokensForETH(amount, 0, _path, address(this), block.timestamp);
        console.log('14.- Amount of ETH received (Uniswap): ', tradedAmounts[1] / 1 ether);


    }







    function balancerSwapV1(IBalancerV1 _pool, uint _amount) private returns(uint) {
        uint amount = _amount;
        WBTC.approve(address(_pool), type(uint).max);

        (uint tokenAmountOut, ) = _pool.swapExactAmountIn(
            address(WBTC), 
            amount, 
            address(WETH), 
            0, 
            type(uint).max
        );
        WETH_int.withdraw(tokenAmountOut);

        return tokenAmountOut;
    }
}